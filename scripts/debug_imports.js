import { PyAnalyzer } from './dist/core/analyzer.js';

const analyzer = new PyAnalyzer();

const source = `
import os
import sys
from typing import List, Dict
from collections import defaultdict
`;

const result = await analyzer.analyzePythonModule(source);
console.log('Imports found:', result.module.imports.length);
console.log('Imports:', JSON.stringify(result.module.imports, null, 2));