"""Recurring quotients have an exact representation, never decimal tolerance."""
import sys
import unittest
from fractions import Fraction
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from insight_decision_checks import CheckError, _expected_number, _number, validate_decision_checks
from test_insight_quality import valid_article
from decision_check_fixture import with_decision_checks


class ExactQuotientTests(unittest.TestCase):
    def test_real_production_quotients_compare_as_exact_fractions(self):
        for numerator,denominator in ((35,3),(62,9),(80,9)):
            article=with_decision_checks(valid_article())
            article["decision_checks"]["calculations"][0].update(inputs={"numerator":str(numerator),"denominator":str(denominator)},expression="numerator/denominator",expected=f"{numerator}/{denominator}")
            with self.subTest(numerator=numerator):
                result=validate_decision_checks(article)
                self.assertTrue(result["passed"],result["errors"])
                self.assertIn({"id":article["decision_checks"]["calculations"][0]["id"],"computed":str(Fraction(numerator,denominator))},result["results"])

    def test_rounded_or_incorrect_expected_values_still_fail(self):
        for expected in ("11.7","11.66666667","34/3","35/4"):
            article=with_decision_checks(valid_article())
            article["decision_checks"]["calculations"][0].update(inputs={"a":"35","b":"3"},expression="a/b",expected=expected)
            with self.subTest(expected=expected):
                self.assertIn("calculation mismatch"," ".join(validate_decision_checks(article)["errors"]))

    def test_fraction_bounds_and_zero_denominator_fail_without_evaluation(self):
        for value in ("1/0","1/-3","1/0003","1000000000000000/3","1/1000000000000000","__import__('os')/3","1/(2+1)","1/3/4"):
            with self.subTest(value=value),self.assertRaises(CheckError):_expected_number(value)
        self.assertEqual(_expected_number("-35/3"),Fraction(-35,3))
        self.assertEqual(_expected_number("70/6"),Fraction(35,3))

    def test_fraction_support_does_not_change_original_input_contract(self):
        with self.assertRaises(CheckError):_number("35/3")
        self.assertEqual(_number("7.2"),Fraction(36,5))


if __name__=="__main__":unittest.main()
