from __future__ import annotations

import unittest

from scripts.options_profiles import OPTIONS_PROFILES, options_profile


class OptionsProfilesTests(unittest.TestCase):
    def test_profiles_cover_supported_pages_without_fabricated_proxies(self) -> None:
        self.assertEqual(len(OPTIONS_PROFILES), 26)
        self.assertEqual(options_profile("BTC")["underlierCandidates"], ("IBIT",))
        self.assertEqual(
            options_profile("ETH")["underlierCandidates"],
            ("ETHA", "ETHE", "FETH", "ETHW"),
        )
        for unsupported in ("BRENTOIL", "CBRS", "COPPER", "CRCL", "CXMT", "EWY", "NATGAS", "SKHX", "SKHY", "SMSN", "SPCX"):
            self.assertNotIn(unsupported, OPTIONS_PROFILES)

    def test_equity_earnings_profiles_use_the_exact_listed_underlier(self) -> None:
        for symbol in ("AAPL", "AMD", "AMZN", "NVDA", "TSLA"):
            profile = options_profile(symbol)
            self.assertEqual(profile["kind"], "earnings")
            self.assertEqual(profile["underlierCandidates"], (symbol,))

    def test_term_profiles_use_approved_spot_or_etf_underliers(self) -> None:
        expected = {
            "BTC": "IBIT",
            "CL": "USO",
            "DRAM": "DRAM",
            "GOLD": "GLD",
            "SILVER": "SLV",
            "SOXL": "SOXL",
            "SP500": "SPY",
            "XYZ100": "QQQ",
        }
        for page_symbol, underlier in expected.items():
            profile = options_profile(page_symbol)
            self.assertEqual(profile["kind"], "term_straddles")
            self.assertEqual(profile["underlierCandidates"], (underlier,))


if __name__ == "__main__":
    unittest.main()
