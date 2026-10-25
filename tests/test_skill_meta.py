"""The skill's frontmatter must fit the limits for uploading to Claude.ai."""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..", "mtg-master")


class SkillMetadata(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "SKILL.md"), encoding="utf-8") as f:
            text = f.read()
        m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        self.assertIsNotNone(m, "SKILL.md needs YAML frontmatter")
        self.front = m.group(1)

    def field(self, name):
        m = re.search(r"^%s:\s*(.+)$" % name, self.front, re.M)
        self.assertIsNotNone(m, "missing %s" % name)
        return m.group(1).strip().strip('"')

    def test_name(self):
        name = self.field("name")
        self.assertRegex(name, r"^[a-z0-9]+(-[a-z0-9]+)*$")
        self.assertLessEqual(len(name), 64)
        self.assertEqual(name, "mtg-master", "must match the folder name")

    def test_description_fits_claude_ai(self):
        # support.claude.com: "description ... (200 characters maximum)"; the open spec allows 1024
        self.assertLessEqual(len(self.field("description")), 200)


if __name__ == "__main__":
    unittest.main()
