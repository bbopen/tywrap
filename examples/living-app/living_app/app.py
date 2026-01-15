from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field as _Field


def _to_camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class _CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=_to_camel)


class ProfileConfig(_CamelModel):
    """Controls how the profiler summarizes a CSV dataset."""

    top_k: int = _Field(default=5, ge=1, le=25)
    sample_rows: int | None = _Field(default=2000, ge=50)
    quantiles: list[float] = _Field(default_factory=lambda: [0.0, 0.5, 0.9, 0.99, 1.0])
    max_unique_categorical: int = _Field(default=25, ge=2, le=200)
    top_correlations: int = _Field(default=10, ge=0, le=50)


class ValueCount(_CamelModel):
    value: str
    count: int
    pct: float


class NumericSummary(_CamelModel):
    count: int
    missing: int
    mean: float | None
    std: float | None
    min: float | None
    max: float | None
    quantiles: dict[str, float]


class CategoricalSummary(_CamelModel):
    count: int
    missing: int
    unique: int
    top: list[ValueCount]


class ColumnProfile(_CamelModel):
    name: str
    dtype: str
    kind: Literal["numeric", "categorical", "other"]
    numeric: NumericSummary | None = None
    categorical: CategoricalSummary | None = None


class Correlation(_CamelModel):
    left: str
    right: str
    pearson: float


class DatasetProfile(_CamelModel):
    path: str
    rows: int
    columns: int
    profiles: list[ColumnProfile]
    correlations: list[Correlation]


class DriftConfig(_CamelModel):
    """Controls drift detection between a baseline and current CSV dataset."""

    numeric_mean_threshold: float = _Field(default=0.15, ge=0.0)
    categorical_l1_threshold: float = _Field(default=0.25, ge=0.0, le=1.0)
    top_k: int = _Field(default=5, ge=1, le=25)


class NumericDrift(_CamelModel):
    column: str
    baseline_mean: float | None
    current_mean: float | None
    relative_change: float | None
    drifted: bool


class CategoricalDrift(_CamelModel):
    column: str
    l1_distance: float
    baseline_top: list[ValueCount]
    current_top: list[ValueCount]
    drifted: bool


class DriftReport(_CamelModel):
    baseline_path: str
    current_path: str
    numeric: list[NumericDrift]
    categorical: list[CategoricalDrift]


def write_synthetic_events_csv(
    path: str,
    rows: int = 500,
    seed: int = 0,
    drift: float = 0.0,
) -> str:
    """
    Write a deterministic, synthetic event dataset to CSV.

    The `drift` parameter nudges the distribution of a few features so that drift
    detection has something meaningful to report.
    """

    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(seed)

    countries = np.array(["US", "CA", "GB", "DE", "IN", "BR"])
    country = rng.choice(
        countries,
        size=rows,
        p=np.array([0.35, 0.1, 0.1, 0.1, 0.25, 0.1]),
    )

    user_id = rng.integers(10_000, 99_999, size=rows)
    sessions_last_7d = rng.poisson(lam=3.0 + drift * 1.5, size=rows)
    support_tickets_last_30d = rng.poisson(lam=0.4 + drift * 0.2, size=rows)

    base_spend = rng.gamma(shape=2.0, scale=18.0 * (1.0 + drift), size=rows)
    spend_usd_last_7d = base_spend * (sessions_last_7d + 1) / 4.0

    signup_days_ago = rng.integers(0, 365 * 2, size=rows)
    signup_ts = pd.Timestamp("2025-01-01") - pd.to_timedelta(signup_days_ago, unit="D")
    signup_date = pd.to_datetime(signup_ts).strftime("%Y-%m-%d")

    churn_logit = (
        -1.5
        + 0.18 * support_tickets_last_30d
        - 0.14 * sessions_last_7d
        + rng.normal(0, 0.35, size=rows)
        + drift * 0.25
    )
    churn_prob = 1.0 / (1.0 + np.exp(-churn_logit))
    churned = rng.random(size=rows) < churn_prob

    df = pd.DataFrame(
        {
            "user_id": user_id.astype(int),
            "country": country.astype(str),
            "signup_date": signup_date,
            "sessions_last_7d": sessions_last_7d.astype(int),
            "support_tickets_last_30d": support_tickets_last_30d.astype(int),
            "spend_usd_last_7d": spend_usd_last_7d.astype(float),
            "churned": churned.astype(bool),
        }
    )

    df.to_csv(out_path, index=False)
    return str(out_path)


def profile_csv(path: str, config: ProfileConfig) -> DatasetProfile:
    """
    Profile a CSV file and return a JSON-serializable dataset summary.

    Note: we return a Pydantic model; the tywrap Python bridge detects `model_dump`
    and serializes it to a JSON-friendly dict for transport to TypeScript.
    """

    cfg = ProfileConfig.model_validate(config)

    df = pd.read_csv(path)
    if cfg.sample_rows is not None and len(df) > cfg.sample_rows:
        df = df.sample(n=cfg.sample_rows, random_state=0)

    profiles: list[ColumnProfile] = []
    for col in df.columns:
        series = df[col]
        missing = int(series.isna().sum())
        dtype = str(series.dtype)

        if pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
            cleaned = pd.to_numeric(series, errors="coerce").dropna()
            quantiles = (
                cleaned.quantile(cfg.quantiles).to_dict() if len(cleaned) > 0 else {}
            )
            numeric = NumericSummary(
                count=int(series.shape[0]),
                missing=missing,
                mean=float(cleaned.mean()) if len(cleaned) > 0 else None,
                std=float(cleaned.std()) if len(cleaned) > 1 else None,
                min=float(cleaned.min()) if len(cleaned) > 0 else None,
                max=float(cleaned.max()) if len(cleaned) > 0 else None,
                quantiles={str(k): float(v) for k, v in quantiles.items()},
            )
            profiles.append(
                ColumnProfile(name=str(col), dtype=dtype, kind="numeric", numeric=numeric)
            )
            continue

        # treat low-cardinality object columns as categorical
        if pd.api.types.is_object_dtype(series) or pd.api.types.is_bool_dtype(series):
            values = series.dropna().astype(str)
            unique = int(values.nunique(dropna=True))
            if unique <= cfg.max_unique_categorical:
                counts = values.value_counts().head(cfg.top_k)
                total = float(values.shape[0]) if values.shape[0] > 0 else 1.0
                top = [
                    ValueCount(value=str(k), count=int(v), pct=float(v) / total)
                    for k, v in counts.items()
                ]
                categorical = CategoricalSummary(
                    count=int(series.shape[0]),
                    missing=missing,
                    unique=unique,
                    top=top,
                )
                profiles.append(
                    ColumnProfile(
                        name=str(col),
                        dtype=dtype,
                        kind="categorical",
                        categorical=categorical,
                    )
                )
                continue

        profiles.append(ColumnProfile(name=str(col), dtype=dtype, kind="other"))

    correlations: list[Correlation] = []
    if cfg.top_correlations > 0:
        numeric_cols = [p.name for p in profiles if p.kind == "numeric"]
        if len(numeric_cols) >= 2:
            corr = df[numeric_cols].corr(numeric_only=True)
            pairs: list[Correlation] = []
            for i, left in enumerate(numeric_cols):
                for right in numeric_cols[i + 1 :]:
                    val = corr.loc[left, right]
                    if pd.isna(val):
                        continue
                    pairs.append(
                        Correlation(left=left, right=right, pearson=float(val))
                    )
            pairs.sort(key=lambda c: abs(c.pearson), reverse=True)
            correlations = pairs[: cfg.top_correlations]

    profile = DatasetProfile(
        path=str(path),
        rows=int(df.shape[0]),
        columns=int(df.shape[1]),
        profiles=profiles,
        correlations=correlations,
    )
    return profile


def _value_counts_normalized(series: pd.Series, *, top_k: int) -> tuple[dict[str, float], list[ValueCount]]:
    values = series.dropna().astype(str)
    counts = values.value_counts()
    total = float(values.shape[0]) if values.shape[0] > 0 else 1.0
    normalized = {str(k): float(v) / total for k, v in counts.items()}
    top = [
        ValueCount(value=str(k), count=int(v), pct=float(v) / total)
        for k, v in counts.head(top_k).items()
    ]
    return normalized, top


def drift_report(
    baseline_path: str, current_path: str, config: DriftConfig
) -> DriftReport:
    """
    Compare two CSVs and return a JSON-serializable drift report.
    """

    cfg = DriftConfig.model_validate(config)
    baseline = pd.read_csv(baseline_path)
    current = pd.read_csv(current_path)

    numeric: list[NumericDrift] = []
    for col in sorted(set(baseline.columns).intersection(current.columns)):
        if not (
            pd.api.types.is_numeric_dtype(baseline[col])
            and pd.api.types.is_numeric_dtype(current[col])
        ):
            continue
        b = pd.to_numeric(baseline[col], errors="coerce").dropna()
        c = pd.to_numeric(current[col], errors="coerce").dropna()
        bmean = float(b.mean()) if len(b) > 0 else None
        cmean = float(c.mean()) if len(c) > 0 else None
        rel = None
        if bmean is not None and cmean is not None and abs(bmean) > 1e-12:
            rel = (cmean - bmean) / abs(bmean)
        drifted = bool(rel is not None and abs(rel) >= cfg.numeric_mean_threshold)
        numeric.append(
            NumericDrift(
                column=str(col),
                baseline_mean=bmean,
                current_mean=cmean,
                relative_change=rel,
                drifted=drifted,
            )
        )

    categorical: list[CategoricalDrift] = []
    for col in sorted(set(baseline.columns).intersection(current.columns)):
        if not (
            pd.api.types.is_object_dtype(baseline[col])
            and pd.api.types.is_object_dtype(current[col])
        ):
            continue
        bdist, btop = _value_counts_normalized(baseline[col], top_k=cfg.top_k)
        cdist, ctop = _value_counts_normalized(current[col], top_k=cfg.top_k)
        keys = set(bdist.keys()).union(cdist.keys())
        l1 = 0.0
        for k in keys:
            l1 += abs(bdist.get(k, 0.0) - cdist.get(k, 0.0))
        l1 = l1 / 2.0
        drifted = l1 >= cfg.categorical_l1_threshold
        categorical.append(
            CategoricalDrift(
                column=str(col),
                l1_distance=float(l1),
                baseline_top=btop,
                current_top=ctop,
                drifted=bool(drifted),
            )
        )

    report = DriftReport(
        baseline_path=str(baseline_path),
        current_path=str(current_path),
        numeric=numeric,
        categorical=categorical,
    )
    return report


def top_users_by_spend(path: str, top_n: int = 10) -> pd.DataFrame:
    """
    Return a small table of the top spenders in the dataset.

    This returns a DataFrame intentionally to exercise the pandas codec path.

    Why: the synthetic dataset always includes spend columns, but in real usage people will
    often swap in their own CSVs. Being defensive here avoids a confusing KeyError.
    """

    df = pd.read_csv(path)
    cols = [
        "user_id",
        "country",
        "sessions_last_7d",
        "support_tickets_last_30d",
        "spend_usd_last_7d",
        "churned",
    ]
    cols = [c for c in cols if c in df.columns]
    if "spend_usd_last_7d" not in df.columns:
        return df[cols].head(top_n)
    return df[cols].sort_values("spend_usd_last_7d", ascending=False).head(top_n)
