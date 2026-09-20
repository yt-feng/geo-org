import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import authority_site
import i18n_site


def document(meta="", title="A page"):
    return (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        f'{meta}<title>{title}</title><style>.fixture{{color:green}}</style>'
        '<link rel="canonical" href="https://example.net/custom-canonical">'
        '<script id="private-schema" type="application/ld+json">{"custom":true}</script>'
        '</head><body><header><nav><div>Existing navigation</div></nav></header>'
        '<main>Keep this content exactly.</main>'
        '<footer class="footer site-footer"><div class="wrap">Fixture</div></footer>'
        '</body></html>'
    )


class AdvisorVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def sitemap_locations(self):
        tree = ET.parse(self.root / "sitemap.xml")
        return {node.text for node in tree.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")}

    def test_known_direct_link_routes_remain_unlisted_even_without_metadata(self):
        for relative in (
            "package-advisor/index.html", "package-advisor/print.html",
            "en/package-advisor/index.html", "ar/package-advisor/index.html",
            ".artifacts/package-advisor/repo/index.html", ".git/example.html",
        ):
            with self.subTest(relative=relative):
                self.assertTrue(i18n_site.is_unlisted_page(Path(relative), document()))
        self.assertFalse(i18n_site.is_unlisted_page(Path("package-advisor-guide/index.html"), document()))

    def test_robots_and_explicit_unlisted_markers_accept_real_html_attribute_variants(self):
        for meta in (
            '<meta name="robots" content="noindex,nofollow">',
            "<META CONTENT='FOLLOW, NOINDEX' NAME='ROBOTS' />",
            '<meta content=noindex name=googlebot>',
            '<meta name="bingbot" content="none">',
            '<meta content="unlisted" name="site-visibility">',
        ):
            with self.subTest(meta=meta):
                self.assertTrue(i18n_site.is_unlisted_page(Path("special/index.html"), document(meta)))
        for meta in (
            '<meta name="robots" content="index,nofollow">',
            '<!-- <meta name="robots" content="noindex"> -->',
            '<meta name="description" content="an article about noindex">',
        ):
            with self.subTest(meta=meta):
                self.assertFalse(i18n_site.is_unlisted_page(Path("public/index.html"), document(meta)))

    def test_authority_patch_preserves_hidden_pages_byte_for_byte_and_still_updates_public_pages(self):
        originals = {
            "package-advisor/index.html": document('<meta name="robots" content="noindex,nofollow">', "Advisor"),
            "en/package-advisor/index.html": document(),
            "client-preview/index.html": document('<meta name="site-visibility" content="unlisted">'),
            "blog/articles/private/index.html": document("<meta content='NOINDEX' name='robots'>"),
            ".artifacts/repo/index.html": document(),
        }
        for relative, content in originals.items():
            self.write(relative, content)
        self.write("index.html", document())
        authority_site.patch_html(self.root)
        for relative, content in originals.items():
            self.assertEqual((self.root / relative).read_text(encoding="utf-8"), content, relative)
        public = (self.root / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="schema-page"', public)
        self.assertIn(f'href="{authority_site.SITE_URL}/"', public)
        self.assertNotIn("private-schema", public)
        self.assertNotIn("package-advisor", public)

    def test_direct_metadata_entry_point_preserves_noindex_documents(self):
        content = document('<meta name="robots" content="noindex">')
        self.assertEqual(authority_site.add_head_authority(content, Path("preview/index.html"), self.root, {}), content)

    def test_language_switcher_sync_does_not_change_noindex_articles(self):
        hidden = document('<meta name="robots" content="noindex">')
        self.write("blog/articles/private/index.html", hidden)
        self.write("blog/articles/public/index.html", document())
        i18n_site.sync_language_switchers(self.root)
        self.assertEqual((self.root / "blog/articles/private/index.html").read_text(encoding="utf-8"), hidden)
        self.assertIn('class="lang-switcher"', (self.root / "blog/articles/public/index.html").read_text(encoding="utf-8"))

    def test_scaffold_does_not_overwrite_an_explicitly_unlisted_existing_page(self):
        hidden = document('<meta name="robots" content="noindex">')
        self.write("en/brand-audit/index.html", hidden)
        i18n_site.ensure_language_scaffold(self.root)
        self.assertEqual((self.root / "en/brand-audit/index.html").read_text(encoding="utf-8"), hidden)
        self.assertTrue((self.root / "ar/brand-audit/index.html").is_file())

    def test_sitemap_excludes_hidden_routes_metadata_and_post_flags_but_keeps_public_entries(self):
        self.write("about/index.html", document('<meta name="robots" content="noindex">'))
        self.write("blog/articles/private/index.html", document('<meta name="site-visibility" content="unlisted">'))
        self.write("blog/articles/public/index.html", document())
        posts = [
            {"slug": "public", "date": "2026-09-20"},
            {"slug": "private"},
            {"slug": "hidden-flag", "unlisted": True},
            {"slug": "hidden-robots-flag", "noindex": True},
            {"slug": "advisor", "url": f"{i18n_site.SITE_URL}/package-advisor/"},
            {"slug": "advisor-alt", "url": "https://www.eco-geo.org/package-advisor/?view=quote"},
            {"slug": "advisor-file", "url": f"{i18n_site.SITE_URL}/package-advisor/index.html"},
            {"slug": "advisor-encoded", "url": f"{i18n_site.SITE_URL}/%70ackage-advisor/"},
            {"slug": "advisor-en", "url": f"{i18n_site.SITE_URL}/en/package-advisor/"},
        ]
        i18n_site.write_sitemap({"zh": posts}, self.root)
        locations = self.sitemap_locations()
        self.assertIn(f"{i18n_site.SITE_URL}/", locations)
        self.assertIn(f"{i18n_site.SITE_URL}/blog/articles/public/", locations)
        self.assertIn(f"{i18n_site.SITE_URL}/en/about/", locations)
        for hidden in ("package-advisor", "private", "hidden-flag", "hidden-robots-flag", "%70ackage-advisor"):
            self.assertFalse(any(hidden in location for location in locations), hidden)
        self.assertNotIn(f"{i18n_site.SITE_URL}/about/", locations)

    def test_public_pages_do_not_advertise_hidden_translations(self):
        self.write("guide/index.html", document())
        self.write("en/guide/index.html", document('<meta name="robots" content="noindex">'))
        self.write("ar/guide/index.html", document())
        alternates = authority_site.alternate_links(self.root, Path("guide/index.html"))
        self.assertIn('hreflang="zh-CN"', alternates)
        self.assertIn('hreflang="ar"', alternates)
        self.assertNotIn('hreflang="en"', alternates)
        self.assertEqual(authority_site.relative_lang_href(self.root, Path("guide/index.html"), "en"), "../en/")

    def test_repeated_generator_maintenance_does_not_modify_or_list_the_advisor(self):
        source = Path(__file__).resolve().parents[1] / "package-advisor/index.html"
        advisor = source.read_text(encoding="utf-8")
        self.write("package-advisor/index.html", advisor)
        self.write("index.html", document())
        for _ in range(2):
            authority_site.patch_html(self.root)
            i18n_site.sync_language_switchers(self.root)
            i18n_site.write_sitemap({}, self.root)
        self.assertEqual((self.root / "package-advisor/index.html").read_text(encoding="utf-8"), advisor)
        self.assertFalse(any("package-advisor" in location for location in self.sitemap_locations()))
        self.assertNotIn("package-advisor", (self.root / "index.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
