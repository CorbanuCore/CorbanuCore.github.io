from __future__ import annotations

import unittest

from scripts.options_profiles import OPTIONS_PROFILES, UNSUPPORTED_OPTIONS_PAGES, options_profile


class OptionsProfilesTests(unittest.TestCase):
    def test_profiles_cover_every_page_with_a_usable_listed_chain(self) -> None:
        self.assertEqual(len(OPTIONS_PROFILES), 34)
        self.assertEqual(options_profile("BTC")["underlierCandidates"], ("IBIT",))
        self.assertEqual(
            options_profile("ETH")["underlierCandidates"],
            ("ETHA", "ETHE", "FETH", "ETHW"),
        )
        self.assertEqual(set(UNSUPPORTED_OPTIONS_PAGES), {"COPPER", "CXMT", "SMSN"})
        self.assertFalse(set(OPTIONS_PROFILES) & set(UNSUPPORTED_OPTIONS_PAGES))
        self.assertEqual(len(set(OPTIONS_PROFILES) | set(UNSUPPORTED_OPTIONS_PAGES)), 37)

    def test_equity_earnings_profiles_use_the_exact_listed_underlier(self) -> None:
        for symbol in ("AAPL", "AMD", "AMZN", "NVDA", "TSLA"):
            profile = options_profile(symbol)
            self.assertEqual(profile["kind"], "earnings")
            self.assertEqual(profile["underlierCandidates"], (symbol,))

    def test_term_profiles_use_approved_spot_or_etf_underliers(self) -> None:
        expected = {
            "BRENTOIL": "BNO",
            "BTC": "IBIT",
            "CBRS": "CBRS",
            "CL": "USO",
            "CRCL": "CRCL",
            "DRAM": "DRAM",
            "EWY": "EWY",
            "GOLD": "GLD",
            "NATGAS": "UNG",
            "SKHX": "SKHY",
            "SKHY": "SKHY",
            "SILVER": "SLV",
            "SOXL": "SOXL",
            "SP500": "SPY",
            "SPCX": "SPCX",
            "XYZ100": "QQQ",
        }
        for page_symbol, underlier in expected.items():
            profile = options_profile(page_symbol)
            self.assertEqual(profile["kind"], "term_straddles")
            self.assertEqual(profile["underlierCandidates"], (underlier,))


if __name__ == "__main__":
    unittest.main()
