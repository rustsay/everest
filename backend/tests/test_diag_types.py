import unittest
from datetime import date

from app.learning import engine
from app.learning.diag_types import PROF


class TypedDiagnosticTests(unittest.TestCase):
    def test_profile_diagnostic_loads_all_types_and_sources(self):
        items = engine.items_of("prof", "11", 0, date(2026, 11, 20), {"_fmt": "types"})
        types = {it["type"] for it in items if it.get("type")}
        types.update(c["type"] for it in items for c in it.get("choices", []))
        self.assertEqual(types, set(PROF))
        self.assertEqual({it["n"] for it in items}, set(range(1, 20)))
        by_type = {it["type"]: it for it in items if it.get("type")}
        self.assertEqual(by_type["1.1"]["src"], "открытый банк ФИПИ")
        self.assertEqual(by_type["1.2"]["src"], "по образцу банка ФИПИ")
        self.assertEqual(by_type["1.3"]["src"], "демоверсия ЕГЭ 2027")

    def test_bank_diagnostics_load_all_tasks_and_sources(self):
        for key, grade, count in (("oge", "9", 25), ("base", "11", 21)):
            with self.subTest(exam=key):
                items = engine.items_of(key, grade, 0, date(2026, 11, 20), {"_fmt": "types"})
                self.assertEqual({it["n"] for it in items}, set(range(1, count + 1)))
                for it in items:
                    problems = it["choices"] if it.get("choices") else [it]
                    for problem in problems:
                        self.assertIn(problem["src"], {"демоверсия 2027", "открытый банк ФИПИ"})
