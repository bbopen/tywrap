#!/usr/bin/env python3
"""
Library integration test suite for tywrap.

Runs IR extraction against a stable set of stdlib and third-party libraries
that represent common wrapping scenarios.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import warnings
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version

# Ensure local tywrap_ir is available
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT_DIR, 'tywrap_ir'))

from tywrap_ir import extract_module_ir

warnings.filterwarnings('ignore', message='TypedStorage is deprecated*', category=UserWarning)


@dataclass(frozen=True)
class LibrarySpec:
    name: str
    import_name: str
    package_name: str | None = None
    min_functions: int = 0
    min_classes: int = 0
    critical_functions: tuple[str, ...] = ()
    critical_classes: tuple[str, ...] = ()


STDLIB_LIBRARIES: tuple[LibrarySpec, ...] = (
    LibrarySpec(
        name='math',
        import_name='math',
        min_functions=10,
        critical_functions=('sin', 'cos', 'sqrt', 'pow'),
    ),
    LibrarySpec(
        name='json',
        import_name='json',
        min_functions=2,
        critical_functions=('dumps', 'loads'),
    ),
    LibrarySpec(
        name='datetime',
        import_name='datetime',
        min_classes=2,
        critical_classes=('date', 'datetime', 'timedelta'),
    ),
    LibrarySpec(
        name='pathlib',
        import_name='pathlib',
        min_classes=2,
        critical_classes=('Path', 'PurePath'),
    ),
    LibrarySpec(
        name='dataclasses',
        import_name='dataclasses',
        min_functions=2,
        critical_functions=('dataclass', 'field'),
    ),
    LibrarySpec(
        name='enum',
        import_name='enum',
        min_classes=2,
        critical_classes=('Enum', 'IntEnum'),
    ),
)

CORE_LIBRARIES: tuple[LibrarySpec, ...] = (
    LibrarySpec(
        name='attrs',
        import_name='attr',
        package_name='attrs',
        min_functions=2,
        min_classes=1,
        critical_functions=('define', 'field'),
    ),
    LibrarySpec(
        name='pydantic',
        import_name='pydantic',
        package_name='pydantic',
        min_functions=2,
        critical_functions=('Field', 'create_model'),
    ),
    LibrarySpec(
        name='pydantic.main',
        import_name='pydantic.main',
        package_name='pydantic',
        min_classes=1,
        critical_classes=('BaseModel',),
    ),
    LibrarySpec(
        name='requests',
        import_name='requests',
        package_name='requests',
        min_functions=3,
        critical_functions=('get', 'post', 'session'),
    ),
    LibrarySpec(
        name='requests.sessions',
        import_name='requests.sessions',
        package_name='requests',
        min_classes=1,
        critical_classes=('Session',),
    ),
    LibrarySpec(
        name='httpx',
        import_name='httpx',
        package_name='httpx',
        min_functions=2,
        min_classes=2,
        critical_functions=('get', 'post'),
        critical_classes=('Client', 'AsyncClient'),
    ),
)

DATA_LIBRARIES: tuple[LibrarySpec, ...] = (
    LibrarySpec(
        name='numpy',
        import_name='numpy',
        package_name='numpy',
        min_functions=10,
        min_classes=1,
        critical_functions=('ones', 'full', 'eye'),
        critical_classes=('ndarray',),
    ),
    LibrarySpec(
        name='pandas',
        import_name='pandas',
        package_name='pandas',
        min_functions=10,
        critical_functions=('read_csv', 'concat'),
    ),
    LibrarySpec(
        name='pandas.core.frame',
        import_name='pandas.core.frame',
        package_name='pandas',
        min_classes=1,
        critical_classes=('DataFrame',),
    ),
    LibrarySpec(
        name='pandas.core.series',
        import_name='pandas.core.series',
        package_name='pandas',
        min_classes=1,
        critical_classes=('Series',),
    ),
    LibrarySpec(
        name='pyarrow',
        import_name='pyarrow',
        package_name='pyarrow',
        min_functions=2,
        critical_functions=('get_include', 'get_libraries'),
    ),
    LibrarySpec(
        name='pyarrow.lib',
        import_name='pyarrow.lib',
        package_name='pyarrow',
        min_classes=1,
        critical_classes=('Table',),
    ),
)

ML_LIBRARIES: tuple[LibrarySpec, ...] = (
    LibrarySpec(
        name='scipy.sparse',
        import_name='scipy.sparse',
        package_name='scipy',
        min_functions=10,
        critical_functions=('issparse', 'diags', 'eye'),
    ),
    LibrarySpec(
        name='torch',
        import_name='torch',
        package_name='torch',
        min_functions=10,
        min_classes=1,
        critical_classes=('Tensor',),
    ),
    LibrarySpec(
        name='sklearn.base',
        import_name='sklearn.base',
        package_name='scikit-learn',
        min_classes=1,
        critical_classes=('BaseEstimator',),
    ),
)


def resolve_suite(suite: str) -> list[LibrarySpec]:
    libraries: list[LibrarySpec] = list(STDLIB_LIBRARIES)
    if suite in ('core', 'all'):
        libraries.extend(CORE_LIBRARIES)
    if suite in ('data', 'all'):
        libraries.extend(DATA_LIBRARIES)
    if suite in ('ml', 'all'):
        libraries.extend(ML_LIBRARIES)
    return libraries


def get_version(pkg_name: str | None) -> str | None:
    if not pkg_name:
        return None
    try:
        return version(pkg_name)
    except PackageNotFoundError:
        return None


def validate_ir(spec: LibrarySpec, ir: dict) -> list[str]:
    issues: list[str] = []
    functions = ir.get('functions') or []
    classes = ir.get('classes') or []

    if len(functions) < spec.min_functions:
        issues.append(
            f"Expected at least {spec.min_functions} functions, got {len(functions)}"
        )
    if len(classes) < spec.min_classes:
        issues.append(
            f"Expected at least {spec.min_classes} classes, got {len(classes)}"
        )

    function_names = {f.get('name') for f in functions if f.get('name')}
    class_names = {c.get('name') for c in classes if c.get('name')}

    missing_functions = [
        name for name in spec.critical_functions if name not in function_names
    ]
    missing_classes = [
        name for name in spec.critical_classes if name not in class_names
    ]

    if missing_functions:
        issues.append(f"Missing critical functions: {missing_functions}")
    if missing_classes:
        issues.append(f"Missing critical classes: {missing_classes}")

    return issues


def extract_ir(module_name: str) -> dict:
    start_time = time.perf_counter()
    ir = extract_module_ir(module_name)
    elapsed = time.perf_counter() - start_time
    ir['_extraction_time_s'] = elapsed
    return ir


def test_library(spec: LibrarySpec) -> dict:
    result: dict = {
        'success': False,
        'import_name': spec.import_name,
        'package_name': spec.package_name,
        'version': get_version(spec.package_name),
        'extraction_time': 0.0,
        'functions_count': 0,
        'classes_count': 0,
        'issues': [],
    }

    try:
        ir = extract_ir(spec.import_name)
        functions = ir.get('functions') or []
        classes = ir.get('classes') or []
        result['extraction_time'] = ir.get('_extraction_time_s', 0.0)
        result['functions_count'] = len(functions)
        result['classes_count'] = len(classes)
        result['issues'] = validate_ir(spec, ir)
        result['success'] = True
    except Exception as exc:  # noqa: BLE001 - we want full error surface here
        result['error'] = str(exc)

    return result


def summarize(results: dict[str, dict]) -> dict:
    total = len(results)
    passed = sum(1 for r in results.values() if r.get('success') and not r.get('issues'))
    failed = total - passed
    avg_time = (
        sum(r.get('extraction_time', 0.0) for r in results.values()) / total
        if total
        else 0.0
    )
    return {
        'total_libraries_tested': total,
        'passed': passed,
        'failed': failed,
        'success_rate': (passed / total) if total else 0.0,
        'average_extraction_time': avg_time,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--suite',
        choices=('core', 'data', 'ml', 'all'),
        default='core',
        help='Which library suite to test.',
    )
    parser.add_argument(
        '--report',
        default=os.path.join(ROOT_DIR, '.tywrap-cache', 'library_integration_report.json'),
        help='Path to write the JSON report.',
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    libraries = resolve_suite(args.suite)

    results: dict[str, dict] = {}
    for spec in libraries:
        print(f"Testing {spec.name}...")
        results[spec.name] = test_library(spec)
        if results[spec.name].get('issues'):
            print(f"  issues: {results[spec.name]['issues']}")
        if not results[spec.name].get('success'):
            print(f"  error: {results[spec.name].get('error')}")

    summary = summarize(results)
    report = {
        'test_timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'suite': args.suite,
        'python_version': sys.version.split()[0],
        'summary': summary,
        'library_results': results,
    }

    report_dir = os.path.dirname(args.report)
    if report_dir:
        os.makedirs(report_dir, exist_ok=True)
    with open(args.report, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2)

    print("\nSummary")
    print(f"  libraries: {summary['total_libraries_tested']}")
    print(f"  passed: {summary['passed']}")
    print(f"  failed: {summary['failed']}")
    print(f"  success rate: {summary['success_rate']:.1%}")

    return 0 if summary['failed'] == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
