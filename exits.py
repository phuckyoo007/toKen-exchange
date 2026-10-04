"""
Early-exit logic for open positions, separate from entry logic on purpose.

SIMPLIFIED, per explicit request -- ONE uniform rule for everything: if
a position has lost 17% of what was paid for it (value has fallen to
83% of entry or below), exit. No per-tier variation, no trailing/peak
logic, no exceptions. A $10 bet exits no later than $8.30.
"""
from dataclasses import dataclass
from typing import Optional
from apply_real_fees import fee_per_contract

STOP_LOSS_ENABLED = True
UNIVERSAL_STOP_LOSS_FRACTION = 0.83   # fires when value falls to <= 83% of original principal


@dataclass
class ExitDecision:
    should_exit: bool
    reason: str = ""


def current_position_value(position: dict, market_price: float) -> float:
    return market_price if position["side"] == "bid" else (1 - market_price)


def check_exit(position: dict, current_market_price: float, current_model_prob: float,
                seconds_remaining: float, reversion_z: Optional[float] = None,
                partial_profit_fraction: Optional[float] = None,
                peak_gain_per_contract: Optional[float] = None) -> ExitDecision:
    entry_price = position["entry_price"]
    count = position["count"]
    value_now = current_position_value(position, current_market_price)

    if not STOP_LOSS_ENABLED:
        return ExitDecision(False)

    # ONE rule, for everything, tag-independent -- checked purely on
    # entry_price and current value, regardless of which tier, coin,
    # or market type placed this position (crypto, manual, sports,
    # anything). This is deliberately the ONLY exit rule in this file.
    bet_amount_dollars = entry_price * count
    current_dollars = value_now * count
    threshold_dollars = bet_amount_dollars * UNIVERSAL_STOP_LOSS_FRACTION
    if current_dollars <= threshold_dollars + 1e-9:
        return ExitDecision(True, f"stop_loss (bet ${bet_amount_dollars:.2f} -> now ${current_dollars:.2f}, "
                                   f"threshold ${threshold_dollars:.2f} -- "
                                   f"{UNIVERSAL_STOP_LOSS_FRACTION*100:.0f}% of original investment, "
                                   f"entry ${entry_price:.2f})")

    return ExitDecision(False)
