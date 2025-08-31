#!/usr/bin/env python3
"""
Simple library integration test for tywrap
"""

import sys
import os
import tempfile
import json
import subprocess
import time

# Add tywrap_ir to path
sys.path.insert(0, './tywrap_ir')

from tywrap_ir import extract_module_ir

def test_library_ir_extraction():
    """Test IR extraction for various Python libraries"""
    
    libraries = {
        # Standard library
        'math': {'expected_functions': 50, 'critical_functions': ['sin', 'cos', 'sqrt']},
        'json': {'expected_functions': 4, 'critical_functions': ['dumps', 'loads']},
        'datetime': {'expected_functions': 10, 'critical_functions': [], 'expected_classes': ['datetime', 'date']},
        
        # Third-party libraries (if installed)
        'numpy': {'expected_functions': 40, 'expected_classes': 50},
        'pandas': {'expected_functions': 50, 'critical_functions': ['read_csv', 'concat']},
        'pydantic': {'expected_functions': 20, 'critical_functions': ['Field']},
        'requests': {'expected_functions': 8, 'critical_functions': ['get', 'post']},
        'fastapi': {'expected_functions': 8, 'critical_functions': ['Body', 'Query']},
    }
    
    results = {}
    
    for lib_name, expectations in libraries.items():
        print(f"\n=== Testing {lib_name} ===")
        try:
            start_time = time.time()
            ir = extract_module_ir(lib_name)
            extraction_time = time.time() - start_time
            
            functions = ir.get('functions', [])
            classes = ir.get('classes', [])
            constants = ir.get('constants', [])
            
            result = {
                'success': True,
                'extraction_time': extraction_time,
                'functions_count': len(functions),
                'classes_count': len(classes),
                'constants_count': len(constants),
                'functions_names': [f.get('name') for f in functions[:10]],
                'classes_names': [c.get('name') for c in classes[:10]],
                'issues': []
            }
            
            # Validate expectations
            if 'expected_functions' in expectations:
                if len(functions) < expectations['expected_functions'] * 0.8:  # Allow 20% variance
                    result['issues'].append(f"Expected ~{expectations['expected_functions']} functions, got {len(functions)}")
            
            if 'expected_classes' in expectations:
                if len(classes) < expectations['expected_classes'] * 0.8:
                    result['issues'].append(f"Expected ~{expectations['expected_classes']} classes, got {len(classes)}")
            
            # Check critical functions exist
            if 'critical_functions' in expectations:
                found_functions = [f.get('name') for f in functions]
                missing_critical = [cf for cf in expectations['critical_functions'] if cf not in found_functions]
                if missing_critical:
                    result['issues'].append(f"Missing critical functions: {missing_critical}")
            
            # Check critical classes exist  
            if 'expected_classes' in expectations and isinstance(expectations['expected_classes'], list):
                found_classes = [c.get('name') for c in classes]
                missing_classes = [ec for ec in expectations['expected_classes'] if ec not in found_classes]
                if missing_classes:
                    result['issues'].append(f"Missing expected classes: {missing_classes}")
            
            print(f"✓ Functions: {len(functions)}, Classes: {len(classes)}, Time: {extraction_time:.3f}s")
            if result['issues']:
                print(f"⚠️  Issues: {', '.join(result['issues'])}")
                
        except Exception as e:
            result = {
                'success': False, 
                'error': str(e),
                'extraction_time': 0,
                'functions_count': 0,
                'classes_count': 0,
                'constants_count': 0
            }
            print(f"✗ Error: {e}")
        
        results[lib_name] = result
    
    return results

def test_type_mapping_quality():
    """Test the quality of type mapping for various scenarios"""
    
    print("\n=== Type Mapping Quality Tests ===")
    
    test_cases = [
        ('numpy', 'array', 'Should handle numpy.ndarray types'),
        ('json', 'loads', 'Should handle Union[str, bytes, bytearray] input'),  
        ('math', 'sin', 'Should handle float input and output'),
        ('requests', 'get', 'Should handle optional parameters and Response return'),
    ]
    
    type_mapping_results = {}
    
    for lib_name, func_name, description in test_cases:
        try:
            ir = extract_module_ir(lib_name)
            functions = ir.get('functions', [])
            
            target_func = None
            for func in functions:
                if func.get('name') == func_name:
                    target_func = func
                    break
            
            if target_func:
                params = target_func.get('parameters', [])
                return_type = target_func.get('return_type', 'unknown')
                
                result = {
                    'found': True,
                    'parameter_count': len(params),
                    'return_type': return_type,
                    'parameters': [(p.get('name'), p.get('type')) for p in params[:5]],
                    'description': description
                }
                print(f"✓ {lib_name}.{func_name}: {len(params)} params, returns {return_type}")
            else:
                result = {
                    'found': False,
                    'description': description
                }
                print(f"✗ {lib_name}.{func_name}: Function not found")
                
        except Exception as e:
            result = {
                'found': False,
                'error': str(e),
                'description': description
            }
            print(f"✗ {lib_name}.{func_name}: Error - {e}")
        
        type_mapping_results[f"{lib_name}.{func_name}"] = result
    
    return type_mapping_results

def generate_compatibility_report(ir_results, type_results):
    """Generate a comprehensive compatibility report"""
    
    report = {
        'test_timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'tywrap_version': '0.2.0',
        'summary': {
            'total_libraries_tested': len(ir_results),
            'successful_extractions': len([r for r in ir_results.values() if r.get('success', False)]),
            'failed_extractions': len([r for r in ir_results.values() if not r.get('success', False)]),
            'total_functions_found': sum([r.get('functions_count', 0) for r in ir_results.values()]),
            'total_classes_found': sum([r.get('classes_count', 0) for r in ir_results.values()]),
            'average_extraction_time': sum([r.get('extraction_time', 0) for r in ir_results.values()]) / len(ir_results)
        },
        'library_results': ir_results,
        'type_mapping_results': type_results,
        'recommendations': []
    }
    
    # Generate recommendations
    failed_libs = [lib for lib, result in ir_results.items() if not result.get('success', False)]
    if failed_libs:
        report['recommendations'].append(f"Failed libraries need investigation: {', '.join(failed_libs)}")
    
    slow_libs = [lib for lib, result in ir_results.items() if result.get('extraction_time', 0) > 5.0]
    if slow_libs:
        report['recommendations'].append(f"Slow extraction times for: {', '.join(slow_libs)} - consider optimization")
    
    libs_with_issues = [lib for lib, result in ir_results.items() if result.get('issues', [])]
    if libs_with_issues:
        report['recommendations'].append(f"Libraries with extraction issues: {', '.join(libs_with_issues)}")
    
    # Performance analysis
    report['performance_analysis'] = {
        'fastest_extraction': min([r.get('extraction_time', float('inf')) for r in ir_results.values()]),
        'slowest_extraction': max([r.get('extraction_time', 0) for r in ir_results.values()]),
        'most_functions': max([r.get('functions_count', 0) for r in ir_results.values()]),
        'most_classes': max([r.get('classes_count', 0) for r in ir_results.values()])
    }
    
    return report

if __name__ == '__main__':
    print("=" * 60)
    print("TYWRAP LIBRARY INTEGRATION TEST SUITE v0.2.0")
    print("=" * 60)
    
    # Test IR extraction
    ir_results = test_library_ir_extraction()
    
    # Test type mapping quality
    type_results = test_type_mapping_quality()
    
    # Generate report
    report = generate_compatibility_report(ir_results, type_results)
    
    print("\n" + "=" * 60)
    print("COMPATIBILITY REPORT SUMMARY")
    print("=" * 60)
    print(f"Libraries tested: {report['summary']['total_libraries_tested']}")
    print(f"Successful extractions: {report['summary']['successful_extractions']}")
    print(f"Failed extractions: {report['summary']['failed_extractions']}")
    print(f"Total functions found: {report['summary']['total_functions_found']}")
    print(f"Total classes found: {report['summary']['total_classes_found']}")
    print(f"Average extraction time: {report['summary']['average_extraction_time']:.3f}s")
    
    if report['recommendations']:
        print(f"\nRecommendations:")
        for rec in report['recommendations']:
            print(f"  • {rec}")
    
    # Save detailed report
    with open('library_integration_report.json', 'w') as f:
        json.dump(report, f, indent=2)
    
    print(f"\n📊 Detailed report saved to: library_integration_report.json")
    
    # Exit with success if most tests passed
    success_rate = report['summary']['successful_extractions'] / report['summary']['total_libraries_tested']
    exit_code = 0 if success_rate >= 0.8 else 1
    print(f"\n{'✅' if exit_code == 0 else '❌'} Success rate: {success_rate:.1%}")
    exit(exit_code)