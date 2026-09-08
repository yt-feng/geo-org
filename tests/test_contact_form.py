"""Component markup and executable JSON submission contract tests (no browser)."""
import json
import shutil
import subprocess
import sys
import unittest
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import contact_form


class Tags(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.tags = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class ContactFormTests(unittest.TestCase):
    def test_all_locales_have_required_fields_optional_fields_and_public_email(self):
        for lang in ("zh", "en", "ar"):
            with self.subTest(lang=lang):
                document = contact_form.contact_form_html(lang)
                tags = Tags(document).tags
                fields = {attrs["name"]: attrs for tag, attrs in tags if tag in {"input", "textarea"}}
                self.assertEqual(set(fields), {"name", "email", "company", "website", "message", "website_confirm"})
                self.assertEqual({key for key, value in fields.items() if "required" in value}, {"name", "email", "message"})
                self.assertEqual(fields["email"]["type"], "email")
                self.assertEqual(fields["email"]["dir"], "ltr")
                self.assertEqual(fields["name"]["minlength"], "2")
                self.assertEqual(fields["message"]["minlength"], "10")
                self.assertEqual(fields["website_confirm"]["tabindex"], "-1")
                section = next(attrs for tag, attrs in tags if tag == "section")
                self.assertEqual(section["id"], "inquiry")
                self.assertEqual(section["lang"], lang)
                self.assertEqual(section["dir"], "rtl" if lang == "ar" else "ltr")
                self.assertIn('href="mailto:info@eco-geo.com" rel="noopener"', document)
                self.assertNotIn("foxmail", document)
                self.assertIn(contact_form.COPY[lang]["privacy"], document)

    def test_defaults_disable_submission_until_script_is_ready_and_avoid_query_strings(self):
        tags = Tags(contact_form.contact_form_html()).tags
        form = next(attrs for tag, attrs in tags if tag == "form")
        button = next(attrs for tag, attrs in tags if tag == "button")
        self.assertEqual(form["data-endpoint"], "/api/contact")
        self.assertEqual(form["method"], "post")
        self.assertIn("disabled", button)
        self.assertTrue(any(tag == "noscript" for tag, _ in tags))

    def test_endpoint_is_configurable_and_not_executable(self):
        document = contact_form.contact_form_html("en", "https://eco-geo-contact.example.workers.dev/api/contact")
        self.assertIn('data-endpoint="https://eco-geo-contact.example.workers.dev/api/contact"', document)
        for value in ("javascript:alert(1)", "//example.com/contact", "http://example.com/contact", "/\\evil.test", "https://user:pass@example.com", "/api/contact#fragment"):
            with self.subTest(endpoint=value), self.assertRaises(ValueError):
                contact_form.contact_form_html(endpoint=value)

    def test_unknown_locale_is_rejected(self):
        with self.assertRaises(ValueError):
            contact_form.contact_form_html("xx")

    def test_script_uses_text_content_and_no_browser_storage(self):
        script = contact_form.contact_form_script()
        self.assertIn("status.textContent = message", script)
        for value in ("innerHTML", "localStorage", "sessionStorage"):
            self.assertNotIn(value, script)

    def test_length_feedback_is_present_in_all_locales(self):
        for lang in ("zh", "en", "ar"):
            with self.subTest(lang=lang):
                script = contact_form.contact_form_script(lang)
                for key in ("name_length", "message_length", "too_long"):
                    self.assertIn(contact_form.COPY[lang][key], script)
                self.assertIn("new TextEncoder().encode(serialized).byteLength > 12000", script)
                self.assertIn("response.status === 413", script)

    @unittest.skipUnless(shutil.which("node"), "Node is required for the lightweight JS contract test")
    def test_submission_success_errors_timeout_and_duplicate_click_contract(self):
        script = contact_form.contact_form_script("zh")
        harness = r'''
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
async function run(statusCode, body, options = {}) {
  let listener, sent, resetCount = 0, requestCount = 0, timer, cleared = false;
  const button = {disabled: true, textContent: ''};
  const status = {textContent: '', dataset: {}};
  const fields = {disabled: false};
  const data = {name:'  Tester  ',email:'a@example.com',company:'Brand',website:'https://example.com',message:'Tell me how to improve my brand.',website_confirm:'',...options.data};
  const form = {dataset:{endpoint:'/api/contact'}, attributes:{},
    elements:{namedItem: key => ({value:data[key]})},
    querySelector: selector => selector === 'fieldset' ? fields : button,
    addEventListener: (event, callback) => {listener = callback;},
    reportValidity: () => options.valid !== false,
    setAttribute: (key, value) => {form.attributes[key] = value;},
    reset: () => {resetCount++;}
  };
  const root = {lang:'zh',classList:{contains:()=>true},querySelector: selector => selector === 'form' ? form : status};
  let resolveRequest;
  const context = {
    document:{currentScript:{previousElementSibling:root}},
    AbortController,
    TextEncoder,
    setTimeout: callback => {timer = callback; return 1;},
    clearTimeout: () => {cleared = true;},
    fetch: async (endpoint, request) => {
      requestCount++; sent = {endpoint, request};
      assert.equal(button.disabled, true); assert.equal(fields.disabled, true);
      assert.equal(form.attributes['aria-busy'], 'true');
      if (options.networkError) throw Error('network');
      if (options.pause) await new Promise(resolve => {resolveRequest = resolve;});
      if (options.timeout) {timer(); assert.equal(request.signal.aborted,true); throw Error('aborted');}
      return {status:statusCode,json:async () => {if (options.badJson) throw Error('json'); return body;}};
    }
  };
  vm.runInNewContext(source, context);
  assert.equal(button.disabled, false);
  const pending = listener({preventDefault(){}});
  if (options.pause) {
    await listener({preventDefault(){}});
    assert.equal(requestCount,1);
    resolveRequest();
  }
  await pending;
  assert.equal(button.disabled,false); assert.equal(fields.disabled,false);
  if (options.valid !== false && !options.clientRejected) {
    assert.equal(form.attributes['aria-busy'],'false'); assert.equal(cleared,true);
    assert.equal(sent.request.method,'POST'); assert.equal(sent.request.headers['Content-Type'],'application/json');
    assert.equal(sent.request.credentials,'omit');
    const payload = JSON.parse(sent.request.body);
    assert.deepEqual(Object.keys(payload).sort(),['name','email','company','website','message','locale','website_confirm'].sort());
    assert.equal(payload.name,data.name.trim()); assert.equal(payload.locale,'zh');
  } else {assert.equal(requestCount,0); assert.equal(resetCount,0);}
  return {status,resetCount,requestCount,sent};
}
(async()=>{
  let result = await run(200,{ok:true,requestId:'request-1'},{pause:true});
  assert.equal(result.status.dataset.state,'success'); assert.equal(result.resetCount,1);
  for (const [status,body,options] of [
    [200,{ok:true},{}],[200,{ok:true,requestId:''},{}],[200,{ok:'true',requestId:'x'},{}],
    [201,{ok:true,requestId:'x'},{}],[500,{ok:true,requestId:'x'},{}],
    [200,null,{badJson:true}],[0,null,{networkError:true}],[0,null,{timeout:true}]
  ]) {result = await run(status,body,options); assert.equal(result.status.dataset.state,'error'); assert.equal(result.resetCount,0);}
  result = await run(429,{}); assert.match(result.status.textContent,/较频繁/);
  result = await run(400,{}); assert.match(result.status.textContent,/请检查/);
  result = await run(413,{}); assert.match(result.status.textContent,/内容过长/); assert.equal(result.resetCount,0);
  for (const name of ['A','  A  ','x'.repeat(101)]) {
    result = await run(0,null,{data:{name},clientRejected:true});
    assert.match(result.status.textContent,/2–100/);
  }
  for (const message of ['short','  123456789  ','x'.repeat(5001)]) {
    result = await run(0,null,{data:{message},clientRejected:true});
    assert.match(result.status.textContent,/10–5,000/);
  }
  result = await run(0,null,{data:{message:'中'.repeat(4100)},clientRejected:true});
  assert.match(result.status.textContent,/内容过长/);
  // Exactly 12,000 encoded bytes is accepted; one extra byte is rejected.
  const boundary = {name:'测试',email:'a@example.com',company:'',website:'',message:'',website_confirm:'',locale:'zh'};
  const overhead = new TextEncoder().encode(JSON.stringify(boundary)).byteLength;
  const budget = 12000-overhead;
  const message = '中'.repeat(Math.floor(budget/3))+'x'.repeat(budget%3);
  result = await run(200,{ok:true,requestId:'boundary'},{data:{...boundary,message}});
  assert.equal(new TextEncoder().encode(result.sent.request.body).byteLength,12000);
  assert.equal(result.status.dataset.state,'success');
  result = await run(0,null,{data:{...boundary,message:message+'x'},clientRejected:true});
  assert.match(result.status.textContent,/内容过长/);
  await run(0,null,{valid:false});
  process.stdout.write('JS contact contract passed\n');
})().catch(error=>{process.stderr.write(error.stack);process.exit(1);});
'''
        result = subprocess.run([shutil.which("node"), "-e", harness], input=json.dumps(script), text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("JS contact contract passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
