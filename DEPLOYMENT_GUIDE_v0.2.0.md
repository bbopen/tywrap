# tywrap v0.2.0 Production Deployment Guide

## 🚀 Overview

This guide provides comprehensive instructions for deploying tywrap v0.2.0 in production environments with security, performance, and reliability best practices.

## ✅ Pre-Deployment Checklist

### Security Requirements
- [ ] Security audit findings addressed
- [ ] Input validation enabled for all user inputs
- [ ] Module whitelist configured for allowed Python libraries
- [ ] Subprocess security hardening implemented
- [ ] Environment variables sanitized
- [ ] Code generation injection protection verified

### Performance Requirements  
- [ ] Caching strategy configured and tested
- [ ] Memory limits and profiling enabled
- [ ] Parallel processing optimized for target environment
- [ ] Bundle size optimization verified
- [ ] Performance benchmarks meet requirements

### Infrastructure Requirements
- [ ] Python 3.8+ installed and accessible
- [ ] Required Python libraries installed (numpy, pandas, etc.)
- [ ] Sufficient memory allocation (minimum 512MB recommended)
- [ ] Storage space for cache and temporary files
- [ ] Network access for Python package installation (if needed)

## 🔧 Production Configuration

### Recommended Production Config
```typescript
// production.config.ts
import { TywrapConfig } from 'tywrap';

export const productionConfig: TywrapConfig = {
  pythonModules: {
    numpy: { 
      runtime: 'node', 
      typeHints: 'strict',
      timeout: 30000 
    },
    pandas: { 
      runtime: 'node', 
      typeHints: 'strict',
      timeout: 45000 
    }
  },
  
  output: {
    dir: './generated',
    format: 'esm',
    declaration: true,
    sourceMap: false, // Disable in production for security
    minify: true,
    treeshake: true
  },
  
  security: {
    inputValidation: true,
    moduleWhitelist: [
      'numpy', 'pandas', 'math', 'json', 'datetime',
      'collections', 'itertools', 'functools'
    ],
    subprocessTimeout: 30000,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    sanitizeEnvironment: true,
    preventPathTraversal: true
  },
  
  performance: {
    caching: {
      enabled: true,
      maxSize: 256 * 1024 * 1024, // 256MB
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      compression: 'gzip',
      strategy: 'lru'
    },
    parallelProcessing: {
      enabled: true,
      maxWorkers: Math.min(4, require('os').cpus().length),
      timeout: 60000
    },
    memoryManagement: {
      maxHeapSize: 512 * 1024 * 1024, // 512MB
      gcThreshold: 0.8,
      leakDetection: true,
      profiling: process.env.NODE_ENV !== 'production'
    },
    batching: {
      enabled: true,
      batchSize: 10,
      timeout: 5000
    }
  },
  
  monitoring: {
    performanceMetrics: true,
    memoryProfiling: process.env.NODE_ENV !== 'production',
    errorReporting: true,
    securityAuditLog: true,
    metricsInterval: 60000 // 1 minute
  },
  
  runtime: {
    node: {
      pythonPath: process.env.PYTHON_PATH || 'python3',
      subprocess: {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        killSignal: 'SIGTERM',
        env: {
          // Minimal environment for security
          PATH: process.env.PATH,
          PYTHONPATH: process.env.PYTHONPATH,
          HOME: process.env.HOME
        }
      }
    }
  },
  
  development: {
    hotReload: false,
    sourceMap: false,
    validation: 'strict',
    memoryProfiling: false
  }
};
```

### Environment Variables
```bash
# .env.production
NODE_ENV=production
PYTHON_PATH=/usr/bin/python3
TYWRAP_CACHE_SIZE=256MB
TYWRAP_SECURITY_MODE=strict
TYWRAP_PERFORMANCE_MODE=optimized
TYWRAP_LOG_LEVEL=info
TYWRAP_METRICS_ENABLED=true
TYWRAP_MEMORY_LIMIT=512MB
```

## 🐳 Docker Deployment

### Multi-Stage Dockerfile
```dockerfile
# Multi-stage build for optimized production image
FROM python:3.11-slim as python-base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Node.js build stage
FROM node:20-alpine as node-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production=false

# Copy source code
COPY . .

# Generate TypeScript wrappers
RUN npm run generate

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine as production

# Install Python
RUN apk add --no-cache python3 py3-pip

# Copy Python dependencies from python-base
COPY --from=python-base /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# Create non-root user
RUN addgroup -g 1001 -S tywrap && \
    adduser -S tywrap -u 1001 -G tywrap

WORKDIR /app

# Copy built application
COPY --from=node-builder --chown=tywrap:tywrap /app/dist ./dist
COPY --from=node-builder --chown=tywrap:tywrap /app/generated ./generated
COPY --from=node-builder --chown=tywrap:tywrap /app/node_modules ./node_modules
COPY --chown=tywrap:tywrap package*.json ./

# Set up cache directory
RUN mkdir -p /app/.tywrap-cache && \
    chown tywrap:tywrap /app/.tywrap-cache

# Switch to non-root user
USER tywrap

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Resource limits
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV TYWRAP_CACHE_SIZE=128MB
ENV TYWRAP_SECURITY_MODE=strict

EXPOSE 3000

CMD ["npm", "start"]
```

### Docker Compose
```yaml
# docker-compose.yml
version: '3.8'

services:
  tywrap-app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PYTHON_PATH=/usr/bin/python3
      - TYWRAP_CACHE_SIZE=256MB
      - TYWRAP_SECURITY_MODE=strict
    volumes:
      - tywrap-cache:/app/.tywrap-cache
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  tywrap-cache:
  redis-data:
```

## ☸️ Kubernetes Deployment

### Deployment Manifest
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tywrap-app
  namespace: production
  labels:
    app: tywrap-app
    version: v0.2.0
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 2
  selector:
    matchLabels:
      app: tywrap-app
  template:
    metadata:
      labels:
        app: tywrap-app
        version: v0.2.0
    spec:
      serviceAccountName: tywrap-service-account
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
      - name: tywrap-app
        image: tywrap-app:v0.2.0
        imagePullPolicy: Always
        ports:
        - containerPort: 3000
          name: http
          protocol: TCP
        env:
        - name: NODE_ENV
          value: "production"
        - name: PYTHON_PATH
          value: "/usr/bin/python3"
        - name: TYWRAP_CACHE_SIZE
          value: "256MB"
        - name: TYWRAP_SECURITY_MODE
          value: "strict"
        - name: TYWRAP_PERFORMANCE_MODE
          value: "optimized"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        volumeMounts:
        - name: cache-volume
          mountPath: /app/.tywrap-cache
        - name: config-volume
          mountPath: /app/config
          readOnly: true
        securityContext:
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
      volumes:
      - name: cache-volume
        persistentVolumeClaim:
          claimName: tywrap-cache-pvc
      - name: config-volume
        configMap:
          name: tywrap-config
      nodeSelector:
        kubernetes.io/os: linux
      tolerations:
      - key: "node.kubernetes.io/unreachable"
        operator: "Exists"
        effect: "NoExecute"
        tolerationSeconds: 6000
```

### Service and Ingress
```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: tywrap-service
  namespace: production
spec:
  selector:
    app: tywrap-app
  ports:
  - name: http
    port: 80
    targetPort: 3000
    protocol: TCP
  type: ClusterIP

---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tywrap-ingress
  namespace: production
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/rate-limit: "100"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
  - hosts:
    - tywrap.yourdomain.com
    secretName: tywrap-tls
  rules:
  - host: tywrap.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: tywrap-service
            port:
              number: 80
```

### ConfigMap
```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: tywrap-config
  namespace: production
data:
  production.config.json: |
    {
      "security": {
        "inputValidation": true,
        "moduleWhitelist": ["numpy", "pandas", "math", "json"],
        "subprocessTimeout": 30000,
        "maxFileSize": 10485760
      },
      "performance": {
        "caching": {
          "enabled": true,
          "maxSize": 268435456,
          "ttl": 86400000
        },
        "parallelProcessing": {
          "enabled": true,
          "maxWorkers": 4
        }
      },
      "monitoring": {
        "performanceMetrics": true,
        "errorReporting": true
      }
    }
```

## 📊 Monitoring & Observability

### Prometheus Metrics
```typescript
// monitoring/metrics.ts
import client from 'prom-client';

// Custom metrics
const tywrapMetrics = {
  // Performance metrics
  irExtractionDuration: new client.Histogram({
    name: 'tywrap_ir_extraction_duration_seconds',
    help: 'Time spent on IR extraction',
    labelNames: ['module', 'status']
  }),
  
  cacheHitRatio: new client.Gauge({
    name: 'tywrap_cache_hit_ratio',
    help: 'Cache hit ratio percentage'
  }),
  
  memoryUsage: new client.Gauge({
    name: 'tywrap_memory_usage_bytes',
    help: 'Current memory usage in bytes'
  }),
  
  // Security metrics
  securityEvents: new client.Counter({
    name: 'tywrap_security_events_total',
    help: 'Total security events detected',
    labelNames: ['type', 'severity']
  }),
  
  // Error metrics
  errors: new client.Counter({
    name: 'tywrap_errors_total',
    help: 'Total errors by type',
    labelNames: ['type', 'module']
  })
};

// Export metrics endpoint
export function setupMetricsEndpoint(app: Express) {
  app.get('/metrics', (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(client.register.metrics());
  });
}
```

### Grafana Dashboard
```json
{
  "dashboard": {
    "title": "tywrap v0.2.0 Production Dashboard",
    "panels": [
      {
        "title": "IR Extraction Performance",
        "targets": [
          {
            "expr": "rate(tywrap_ir_extraction_duration_seconds_sum[5m])",
            "legendFormat": "{{module}}"
          }
        ]
      },
      {
        "title": "Cache Hit Ratio",
        "targets": [
          {
            "expr": "tywrap_cache_hit_ratio",
            "legendFormat": "Hit Ratio %"
          }
        ]
      },
      {
        "title": "Memory Usage",
        "targets": [
          {
            "expr": "tywrap_memory_usage_bytes",
            "legendFormat": "Memory (bytes)"
          }
        ]
      },
      {
        "title": "Security Events",
        "targets": [
          {
            "expr": "rate(tywrap_security_events_total[5m])",
            "legendFormat": "{{type}} - {{severity}}"
          }
        ]
      }
    ]
  }
}
```

### Health Check Endpoints
```typescript
// health/checks.ts
import express from 'express';

export function setupHealthChecks(app: express.Application) {
  // Liveness probe
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.2.0'
    });
  });
  
  // Readiness probe
  app.get('/ready', async (req, res) => {
    try {
      // Check Python availability
      const pythonCheck = await checkPythonAvailability();
      
      // Check cache system
      const cacheCheck = await checkCacheSystem();
      
      // Check memory usage
      const memoryCheck = checkMemoryUsage();
      
      if (pythonCheck && cacheCheck && memoryCheck) {
        res.status(200).json({
          status: 'ready',
          checks: {
            python: pythonCheck,
            cache: cacheCheck,
            memory: memoryCheck
          }
        });
      } else {
        res.status(503).json({
          status: 'not ready',
          checks: {
            python: pythonCheck,
            cache: cacheCheck,
            memory: memoryCheck
          }
        });
      }
    } catch (error) {
      res.status(503).json({
        status: 'error',
        error: error.message
      });
    }
  });
}
```

## 🔐 Security Configuration

### Security Hardening Checklist
```bash
#!/bin/bash
# security-hardening.sh

echo "🔒 tywrap v0.2.0 Security Hardening"

# 1. Update system packages
apt-get update && apt-get upgrade -y

# 2. Install security tools
apt-get install -y fail2ban ufw

# 3. Configure firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  # SSH
ufw allow 80/tcp  # HTTP
ufw allow 443/tcp # HTTPS
ufw --force enable

# 4. Set file permissions
chown -R tywrap:tywrap /app
chmod -R 755 /app
chmod 600 /app/.env*

# 5. Configure Python security
pip install --upgrade pip
pip audit # Check for vulnerabilities

# 6. Enable security logging
echo "Security hardening complete ✅"
```

### Network Security
```yaml
# k8s/network-policy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tywrap-network-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: tywrap-app
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 3000
  egress:
  - to: []
    ports:
    - protocol: TCP
      port: 53  # DNS
    - protocol: UDP
      port: 53  # DNS
  - to:
    - namespaceSelector:
        matchLabels:
          name: kube-system
```

## 🚨 Incident Response

### Alert Configuration
```yaml
# alerts/tywrap-alerts.yml
groups:
- name: tywrap
  rules:
  - alert: TywrapHighErrorRate
    expr: rate(tywrap_errors_total[5m]) > 0.1
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: "High error rate detected"
      description: "tywrap error rate is {{ $value }} errors per second"
  
  - alert: TywrapMemoryHigh
    expr: tywrap_memory_usage_bytes > 800000000  # 800MB
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High memory usage"
      description: "tywrap memory usage is {{ $value }} bytes"
  
  - alert: TywrapSecurityEvent
    expr: increase(tywrap_security_events_total[1m]) > 0
    for: 0m
    labels:
      severity: critical
    annotations:
      summary: "Security event detected"
      description: "Security event: {{ $labels.type }}"
```

### Runbook
```markdown
# tywrap Incident Response Runbook

## High Memory Usage
1. Check Grafana dashboard for memory trends
2. Review application logs for memory leaks
3. Restart affected pods: `kubectl rollout restart deployment/tywrap-app`
4. Scale horizontally if needed: `kubectl scale deployment/tywrap-app --replicas=5`

## Security Events
1. Immediately check security logs
2. Identify source IP and block if malicious
3. Review input validation logs
4. Update security rules if needed
5. Document incident for security review

## Performance Degradation
1. Check cache hit ratio and performance metrics
2. Review Python subprocess performance
3. Consider increasing resource limits
4. Enable memory profiling for detailed analysis
```

## 📈 Performance Tuning

### Optimization Checklist
- [ ] Cache configuration tuned for workload
- [ ] Memory limits optimized for usage patterns
- [ ] Parallel processing configured for CPU cores
- [ ] Bundle size minimized with tree-shaking
- [ ] Python subprocess timeout optimized
- [ ] Network timeouts configured appropriately

### Performance Monitoring
```typescript
// performance/monitor.ts
import { PerformanceObserver } from 'perf_hooks';

class TywrapPerformanceMonitor {
  private metrics = new Map();
  
  startMonitoring() {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.recordMetric(entry.name, entry.duration);
      }
    });
    obs.observe({ entryTypes: ['measure'] });
  }
  
  measureOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return new Promise(async (resolve, reject) => {
      performance.mark(`${name}-start`);
      try {
        const result = await operation();
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  }
}
```

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow
```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*'

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm audit
    - run: npm run security-scan
    
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-python@v4
      with:
        python-version: '3.11'
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: pip install numpy pandas
    - run: npm ci
    - run: npm test
    - run: npm run test:security
    - run: npm run test:performance
    
  build-and-deploy:
    needs: [security-scan, test]
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - name: Build Docker image
      run: docker build -t tywrap-app:${{ github.ref_name }} .
    - name: Deploy to Kubernetes
      run: kubectl apply -f k8s/
```

## 📚 Additional Resources

### Documentation Links
- [Security Best Practices](./docs/security.md)
- [Performance Optimization](./docs/performance.md) 
- [Monitoring Guide](./docs/monitoring.md)
- [Troubleshooting](./docs/troubleshooting.md)

### Support Channels
- **Production Issues**: Create GitHub issue with `production` label
- **Security Vulnerabilities**: Email security@yourorg.com
- **Performance Questions**: Use GitHub discussions

### Maintenance Schedule
- **Security Updates**: Monthly (first Monday)
- **Performance Reviews**: Quarterly
- **Dependency Updates**: Bi-weekly (automated)
- **Capacity Planning**: Quarterly

---

**tywrap v0.2.0** - Production ready. Enterprise secure. Designed to scale.