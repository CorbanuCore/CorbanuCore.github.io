import math
import unittest

import pandas as pd

from build_article_data import (
    EQUITY_BOOK,
    ONCHAIN_BOOK,
    _aggregate_forward_valuation,
    _historical_aggregate_forward_valuation,
)


class AggregateForwardValuationTests(unittest.TestCase):
    def test_negative_eps_is_included_before_yield_is_inverted(self) -> None:
        records = {
            "PROFIT": {"best_eps_1bf": 10.0, "px_last": 100.0},
            "LOSS": {"best_eps_1bf": -4.0, "px_last": 100.0},
        }
        weighted_yield, pe_equivalent, coverage = _aggregate_forward_valuation(
            records,
            {"PROFIT": 0.5, "LOSS": 0.5},
        )

        self.assertTrue(math.isclose(weighted_yield or 0.0, 0.03))
        self.assertTrue(math.isclose(pe_equivalent or 0.0, 1.0 / 0.03))
        self.assertTrue(math.isclose(coverage, 1.0))

    def test_missing_estimate_reduces_coverage_but_not_valid_weighting(self) -> None:
        records = {
            "VALID": {"best_eps_1bf": 5.0, "px_last": 100.0},
            "MISSING": {"best_eps_1bf": None, "px_last": 100.0},
        }
        weighted_yield, pe_equivalent, coverage = _aggregate_forward_valuation(
            records,
            {"VALID": 0.6, "MISSING": 0.4},
        )

        self.assertTrue(math.isclose(weighted_yield or 0.0, 0.05))
        self.assertTrue(math.isclose(pe_equivalent or 0.0, 20.0))
        self.assertTrue(math.isclose(coverage, 0.6))

    def test_historical_series_uses_contemporaneous_prices_and_keeps_losses(self) -> None:
        eps = pd.DataFrame(
            {"PROFIT": [10.0, 12.0], "LOSS": [-4.0, -6.0]},
            index=pd.to_datetime(["2026-01-09", "2026-01-16"]),
        )
        prices = pd.DataFrame(
            {"PROFIT": [100.0, 120.0], "LOSS": [100.0, 100.0]},
            index=pd.to_datetime(["2026-01-08", "2026-01-15"]),
        )
        history = _historical_aggregate_forward_valuation(
            eps,
            prices,
            {"PROFIT": 0.5, "LOSS": 0.5},
        )

        self.assertEqual(len(history), 2)
        self.assertTrue(math.isclose(history.iloc[0]["forward_eps_yield_pct"], 3.0))
        self.assertTrue(math.isclose(history.iloc[1]["forward_eps_yield_pct"], 2.0))
        self.assertTrue(math.isclose(history.iloc[0]["forward_pe_equivalent"], 1.0 / 0.03))

    def test_historical_negative_aggregate_yield_is_not_inverted(self) -> None:
        eps = pd.DataFrame(
            {"PROFIT": [1.0], "LOSS": [-5.0]},
            index=pd.to_datetime(["2026-01-09"]),
        )
        prices = pd.DataFrame(
            {"PROFIT": [100.0], "LOSS": [100.0]},
            index=pd.to_datetime(["2026-01-09"]),
        )
        history = _historical_aggregate_forward_valuation(
            eps,
            prices,
            {"PROFIT": 0.5, "LOSS": 0.5},
        )

        self.assertTrue(math.isclose(history.iloc[0]["forward_eps_yield_pct"], -2.0))
        self.assertTrue(math.isnan(history.iloc[0]["forward_pe_equivalent"]))


class BasketIntegrityTests(unittest.TestCase):
    def test_cash_book_is_one_hundred_percent_gross(self) -> None:
        gross = sum(weight for positions in EQUITY_BOOK.values() for _, weight in positions)
        self.assertTrue(math.isclose(gross, 100.0, abs_tol=2e-6))
        self.assertFalse(
            math.isclose(
                sum(weight for _, weight in EQUITY_BOOK["long"]),
                sum(weight for _, weight in EQUITY_BOOK["short"]),
                abs_tol=1e-5,
            )
        )

    def test_onchain_book_is_one_hundred_percent_gross(self) -> None:
        gross = sum(weight for positions in ONCHAIN_BOOK.values() for _, weight in positions)
        self.assertTrue(math.isclose(gross, 100.0, abs_tol=2e-6))

    def test_onchain_symbols_are_equities_not_legacy_tokens(self) -> None:
        selected = {symbol for positions in ONCHAIN_BOOK.values() for symbol, _ in positions}
        self.assertFalse(selected & {"BTC", "ETH", "SOL", "LINK", "AAVE", "CRV", "ARB", "ZRO"})

    def test_published_books_offset_snapshot_beta(self) -> None:
        snapshot_betas = {
            "TENB": 1.0106939877, "YOU": 0.7846371828, "QLYS": 0.8487349267,
            "GEN": 0.8965746979, "FFIV": 1.0295529608, "IT": 0.7781084110,
            "KD": 1.2344194263, "ANET": 1.8521959210, "CHKP": 0.4421627063,
            "AVPT": 1.0800651835, "OKTA": 1.1909655273, "ESTC": 1.3317119853,
            "TSLA": 2.3679174418, "CVNA": 2.2351101153, "YUM": 0.3124104161,
            "COIN": 2.6028525819, "TTWO": 0.6605879495, "RIVN": 1.5094694823,
            "MSCI": 0.6721664232, "FLUT": 0.9597639289, "MOH": 0.0871260446,
            "PODD": 0.6362877540, "AUR": 2.6685474096, "CSGP": 0.7220090581,
            "ATO": 0.1048030364, "WTRG": -0.1318394726,
            "PLTR": 2.0623282426, "MSFT": 0.9644707751, "AMZN": 1.4058787292,
            "INTC": 2.0227627311, "CRCL": 2.2293522989, "HOOD": 2.8310245303,
        }
        for book in (EQUITY_BOOK, ONCHAIN_BOOK):
            net_beta = sum(
                (1.0 if leg == "long" else -1.0)
                * weight
                / 100.0
                * snapshot_betas[ticker]
                for leg, positions in book.items()
                for ticker, weight in positions
            )
            self.assertTrue(math.isclose(net_beta, 0.0, abs_tol=5e-5))


if __name__ == "__main__":
    unittest.main()
