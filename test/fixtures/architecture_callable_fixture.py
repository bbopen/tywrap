"""Controlled overload and return-validation cases for the clean consumer."""

from __future__ import annotations

import typing


@typing.overload
def select_record(key: str) -> dict[str, dict[str, str]]: ...


@typing.overload
def select_record(key: int) -> dict[str, dict[str, int]]: ...


def select_record(key: str | int) -> dict[str, dict[str, str | int]]:
    return {'outer': {'value': key}}


@typing.overload
def select_record_wrong(key: str) -> dict[str, dict[str, str]]: ...


@typing.overload
def select_record_wrong(key: int) -> dict[str, dict[str, int]]: ...


def select_record_wrong(key: str | int) -> dict[str, dict[str, str | int]]:
    if isinstance(key, str):
        return {'outer': {'value': 42}}
    return {'outer': {'value': 'not an integer'}}


def wrong_integer_return() -> int:
    return 'not an integer'
