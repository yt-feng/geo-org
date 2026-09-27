"""Real synthetic PDFs through the same HTTP, extraction and evidence path as Actions."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timezone
from email.message import Message
from types import SimpleNamespace
from unittest import mock

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import generate_daily_blog as daily
import insight_research as research


def synthetic_pdf(text="Synthetic legal services methodology and client choice evidence. " * 30,
                  *, pages=1, encrypted=False):
    writer = PdfWriter()
    writer.add_metadata({"/Title": "Synthetic legal services study", "/CreationDate": "D:20260926000000Z"})
    for _ in range(pages):
        page = writer.add_blank_page(width=612, height=792)
        if text:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                     NameObject("/Subtype"): NameObject("/Type1"),
                                     NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({
                NameObject("/F1"): writer._add_object(font)})})
            content = DecodedStreamObject()
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            content.set_data(f"BT /F1 10 Tf 20 700 Td ({escaped}) Tj ET".encode("ascii"))
            page[NameObject("/Contents")] = writer._add_object(content)
    if encrypted:
        writer.encrypt("synthetic-password")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def response(raw, url, content_type="application/pdf", content_length=None):
    stream = io.BytesIO(raw)
    stream.headers = Message()
    stream.headers["Content-Type"] = content_type
    if content_length is not None:
        stream.headers["Content-Length"] = str(content_length)
    stream.status = 200
    stream.geturl = lambda: url
    return stream


class PDFResearchTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.url = "https://www.oecd.org/synthetic-legal-services.pdf"

    def fetch(self, raw, content_type="application/pdf", max_bytes=100000, **kwargs):
        opener = mock.Mock()
        opener.open.return_value = response(raw, self.url, content_type, **kwargs)
        with mock.patch.object(research.urllib.request, "build_opener", return_value=opener):
            return research._fetch_source({"url": self.url}, max_bytes, 7)

    def test_selectable_pdf_preserves_body_metadata_and_provenance(self):
        text = "Synthetic legal services evidence. " * 50
        body, url, metadata, method = self.fetch(synthetic_pdf(text))
        self.assertEqual(body, text.strip())
        self.assertEqual(url, self.url)
        self.assertEqual(method, "https_pdf_text")
        self.assertEqual(metadata, {"title": "Synthetic legal services study"})
        self.assertNotIn("published", metadata)  # Creation date is not publication.

    def test_wrong_text_mime_type_does_not_promote_pdf_objects_to_evidence(self):
        for mime in ("text/plain", "text/html"):
            with self.subTest(mime=mime):
                body, _, _, method = self.fetch(synthetic_pdf(), mime)
                self.assertIn("legal services", body)
                self.assertNotIn("endobj", body)
                self.assertEqual(method, "https_pdf_text")
                with self.assertRaisesRegex(research.ResearchError, "incomplete PDF"):
                    self.fetch(b"%PDF-1.7", mime)

    def test_corrupt_encrypted_empty_image_only_and_oversized_pdfs_fail_closed(self):
        cases = [(b"not a PDF", "PDF header"),
                 (b"%PDF-1.7\ninvalid\n%%EOF", "PDF text extraction failed"),
                 (synthetic_pdf()[:-6], "incomplete PDF"),
                 (synthetic_pdf(encrypted=True), "encrypted"),
                 (synthetic_pdf(pages=0), "no pages"),
                 (synthetic_pdf(text=""), "no selectable text"),
                 (synthetic_pdf(pages=301, text=""), "maximum is 300")]
        for raw, reason in cases:
            with self.subTest(reason=reason), self.assertRaisesRegex(research.ResearchError, reason):
                self.fetch(raw)
        raw = synthetic_pdf()
        for declared in (None, len(raw)):
            with self.subTest(content_length=declared), self.assertRaisesRegex(research.ResearchError, "byte limit"):
                self.fetch(raw, max_bytes=len(raw) - 1, content_length=declared)

    def test_fixture_pdf_uses_real_extraction_and_keeps_fixture_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "source.pdf"
            path.write_bytes(synthetic_pdf())
            body, _, _, method = research._fetch_source({"url": self.url, "_fixture_path": str(path)}, 100000, 7)
        self.assertIn("legal services", body)
        self.assertEqual(method, "local_fixture")

    def test_pdf_industry_alias_can_span_lines(self):
        self.assertEqual(research._industry_mentions("Quality of legal\nservices", {"legal_services"}), {"legal_services"})

    def test_pdf_redirect_cannot_change_to_untrusted_host(self):
        opener = mock.Mock()
        opener.open.return_value = response(synthetic_pdf(), "https://untrusted.example/source.pdf")
        with mock.patch.object(research.urllib.request, "build_opener", return_value=opener), \
                self.assertRaisesRegex(research.ResearchError, "allowlist"):
            research._fetch_source({"url": self.url}, 100000, 7)

    def test_changing_search_results_cannot_remove_independent_industry_fallbacks(self):
        topic = daily.gb.TopicRow(706, "Legal services GEO", {"行业": "法律服务"}, "法律服务", "GEO")
        curated = [s for s in research.DEFAULT_SOURCES if "legal_services" in s.get("industries", [])]
        self.assertGreaterEqual(len({research.TRUSTED_HOSTS[research.urllib.parse.urlsplit(s["url"]).hostname][0]
                                     for s in curated}), 2)
        failed_search = [
            {"url": "https://www.oecd.org/blocked-justice.html", "title": "Legal services research"},
            {"url": "https://www.oecd.org/oversized-legal-services.pdf", "title": "Legal services research"},
        ]
        fetched = []
        deny_oecd = False

        def fetch(source, *_):
            url = source["url"]
            fetched.append(url)
            if url in {item["url"] for item in failed_search}:
                raise research.ResearchError("Source response exceeds the byte limit" if url.endswith(".pdf") else "HTTP Error 403")
            if deny_oecd and "www.oecd.org/" in url:
                raise research.ResearchError("HTTP Error 403")
            body = (("Synthetic legal services client-choice evidence. " if source.get("_matched_industries") else "Synthetic general search evidence. ")
                    + url + " ") * 30
            anchor = source.get("excerpt_anchor", "")
            return anchor + " " + body, url, {}, "https_pdf_text" if url.endswith(".pdf") else "https_fetch"

        with mock.patch.object(research, "_fetch_source", side_effect=fetch):
            for leads in ([], failed_search, list(reversed(failed_search))):
                for deny_oecd in (False, True):
                    with self.subTest(leads=len(leads), oecd_unavailable=deny_oecd):
                        pack = research.build_research_pack(topic, leads)
                        industry = [s for s in pack if "legal_services" in s["industries"]]
                        self.assertTrue(industry)
                        self.assertTrue(any(s["url"] in {entry["url"] for entry in curated} for s in industry))
                        if deny_oecd:
                            self.assertTrue(any(s["publisher_domain"] == "gov.uk" for s in industry))
            self.assertTrue(all("industry_context" == s["evidence_role"] for s in industry))

    def test_industry_replay_repeated_day_next_topic_and_failure_recovery(self):
        # Replay 9/24-25: the HTML source is forbidden, but the alternative is
        # a complete PDF. Simulate subsequent schedules and a different industry.
        first = daily.gb.TopicRow(706, "Legal services GEO", {"行业": "法律服务"}, "法律服务", "GEO")
        second = daily.gb.TopicRow(707, "Consumer electronics GEO", {"行业": "消费电子"}, "消费电子", "GEO")
        generic = [{"url": f"https://{host}/synthetic", "title": "GEO evidence", "tags": ["GEO"]}
                   for host in ("developers.google.com", "blogs.bing.com")]
        candidates = [*generic,
                      {"url": "https://www.oecd.org/forbidden", "title": "Industry study", "industries": ["legal_services", "consumer_electronics"]},
                      {"url": self.url, "title": "Industry study PDF", "industries": ["legal_services", "consumer_electronics"]}]
        broken = False
        requested = []

        def open_source(request, **kwargs):
            requested.append(request.full_url)
            if request.full_url.endswith("forbidden"):
                error = urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)
                error.close()
                raise error
            if request.full_url == self.url:
                raw = b"%PDF-1.7" if broken else synthetic_pdf(
                    "Synthetic legal services and consumer electronics evidence. " * 30)
                return response(raw, request.full_url)
            text = (f"Synthetic scoped research for {request.full_url}. " * 30).encode()
            return response(b"<article>" + text + b"</article>", request.full_url, "text/html")

        opener = mock.Mock()
        opener.open.side_effect = open_source
        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.object(research, "DEFAULT_SOURCES", candidates), \
                mock.patch.object(research.urllib.request, "build_opener", return_value=opener), \
                mock.patch.object(research, "datetime", wraps=datetime) as clock:
            results = []
            for day, posts in [(26, []), (26, []), (27, []), (28, [{"row": "706"}])]:
                clock.now.return_value = datetime(2026, 9, day, tzinfo=timezone.utc)
                topic = daily.select_next_topic([first, second], posts, Path(folder))
                results.append(research.build_research_pack(topic, []))
            self.assertEqual([s["text_sha256"] for s in results[0]], [s["text_sha256"] for s in results[2]])
            self.assertNotEqual(results[0][0]["retrieved_at"], results[2][0]["retrieved_at"])
            self.assertIn(["consumer_electronics"], [s["industries"] for s in results[-1]])
            self.assertIn(self.url, requested)
            self.assertTrue(all(s["retrieval_method"] in {"https_fetch", "https_pdf_text"} for s in results[0]))
            broken = True
            with self.assertRaisesRegex(research.ResearchError, "Missing industry evidence: legal_services"):
                research.build_research_pack(first, [])
            broken = False
            recovered = research.build_research_pack(first, [])
            self.assertEqual([s["text_sha256"] for s in recovered], [s["text_sha256"] for s in results[0]])
            for source in recovered:
                self.assertEqual(source["text_sha256"], hashlib.sha256(source["text"].encode()).hexdigest())


if __name__ == "__main__":
    unittest.main()
