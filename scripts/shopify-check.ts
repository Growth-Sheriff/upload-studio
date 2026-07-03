#!/usr/bin/env npx tsx







import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';





const CONFIG = {

  REQUIRED_API_VERSION: '2025-10',


  DEPRECATED_VERSIONS: ['2024-01', '2024-04', '2024-07', '2024-10', '2023-01', '2023-04', '2023-07', '2023-10'],


  SCAN_DIRS: ['app', 'workers', 'extensions', 'theme-snippets'],


  SKIP_DIRS: ['node_modules', 'build', 'dist', '.git', '.next'],


  CHECK_EXTENSIONS: ['.ts', '.tsx', '.js', '.jsx', '.liquid', '.json'],


  CONFIG_FILES: ['shopify.app.toml', 'shopify.app.fdt.toml', 'shopify.extension.toml'],
};





interface CheckResult {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

interface CheckSummary {
  totalFiles: number;
  checkedFiles: number;
  errors: number;
  warnings: number;
  infos: number;
  passed: boolean;
}

const results: CheckResult[] = [];
let filesChecked = 0;
let totalFiles = 0;





const RULES = {

  API_VERSION_WRONG: {
    name: 'api-version-wrong',
    description: 'Wrong API version in code (not matching required version)',
    severity: 'error' as const,
    patterns: [{
      regex: /\/admin\/api\/(\d{4}-\d{2})\/graphql\.json/g,
      checkFn: (match: string) => {
        const versionMatch = match.match(/(\d{4}-\d{2})/);
        if (versionMatch && versionMatch[1] !== CONFIG.REQUIRED_API_VERSION) {
          return {
            isError: true,
            foundVersion: versionMatch[1],
          };
        }
        return null;
      },
      message: 'Wrong API version found',
      suggestion: `Update to ${CONFIG.REQUIRED_API_VERSION}`,
    }],
  },

  API_VERSION_DEPRECATED: {
    name: 'api-version-deprecated',
    description: 'Deprecated API version detected',
    severity: 'error' as const,
    patterns: CONFIG.DEPRECATED_VERSIONS.map(v => ({
      regex: new RegExp(`api[_-]?version\\s*[=:]\\s*["']?${v}["']?`, 'gi'),
      message: `Deprecated API version ${v} found`,
      suggestion: `Update to ${CONFIG.REQUIRED_API_VERSION}`,
    })),
  },

  API_VERSION_HARDCODED: {
    name: 'api-version-hardcoded',
    description: 'Hardcoded API version in URL',
    severity: 'warning' as const,
    patterns: [{
      regex: /\/admin\/api\/(\d{4}-\d{2})\//g,
      message: 'Hardcoded API version in URL',
      suggestion: 'Use environment variable or config for API version',
    }],
  },



  REST_API_USAGE: {
    name: 'rest-api-forbidden',
    description: 'REST API usage detected (GraphQL only)',
    severity: 'error' as const,
    patterns: [{

      regex: /\/admin\/api\/\d{4}-\d{2}\/(?!graphql)[a-z_]+\.json/g,
      message: 'REST API endpoint detected',
      suggestion: 'Use GraphQL API instead of REST endpoints',
    }, {

      regex: /\/admin\/api\/\d{4}-\d{2}\/(products|orders|customers|collections|variants|metafields)\.json/g,
      message: 'REST API resource endpoint detected',
      suggestion: 'Use admin.graphql() with GraphQL queries instead',
    }],
  },


  WEBHOOK_NO_HMAC: {
    name: 'webhook-no-hmac',
    description: 'Webhook handler without HMAC verification',
    severity: 'warning' as const,
    filePattern: /webhooks\./,
    patterns: [{
      checkFn: (content: string) => {
        const hasWebhook = content.includes('webhook') || content.includes('Webhook');
        const hasHmac = content.includes('hmac') || content.includes('HMAC') ||
                        content.includes('shopify.authenticate') || content.includes('authenticate.webhook');
        return hasWebhook && !hasHmac;
      },
      message: 'Webhook handler may lack HMAC verification',
      suggestion: 'Use authenticate.webhook() from @shopify/shopify-app-remix',
    }],
  },


  SESSION_NO_VERIFY: {
    name: 'session-no-verify',
    description: 'Session handling without proper verification',
    severity: 'warning' as const,
    patterns: [{
      regex: /session\s*=.*getSession|localStorage\.getItem.*session/gi,
      message: 'Custom session handling detected',
      suggestion: 'Use authenticate.admin() for secure session handling',
    }],
  },


  GDPR_MISSING_HANDLERS: {
    name: 'gdpr-handlers',
    description: 'GDPR webhook handlers check',
    severity: 'info' as const,
    globalCheck: true,
    checkFn: (allFiles: string[]) => {
      const requiredHandlers = [
        'api.gdpr.customers.data_request',
        'api.gdpr.customers.redact',
        'api.gdpr.shop.redact',
      ];
      const missing = requiredHandlers.filter(h =>
        !allFiles.some(f => f.includes(h))
      );
      return missing.length === 0 ? null : {
        message: `Missing GDPR handlers: ${missing.join(', ')}`,
        suggestion: 'Create required GDPR webhook handlers',
      };
    },
  },


  TENANT_NO_SHOP_ID: {
    name: 'tenant-no-shop-id',
    description: 'Database query without shop_id filter',
    severity: 'warning' as const,
    patterns: [{
      regex: /prisma\.\w+\.(findMany|findFirst|findUnique|update|delete)\s*\(\s*\{(?![^}]*shopId)[^}]*\}/gs,
      message: 'Prisma query may lack shop_id filter',
      suggestion: 'Add shopId to where clause for tenant isolation',
    }],
  },


  DIRECT_FILE_STREAM: {
    name: 'direct-file-stream',
    description: 'Backend file streaming detected',
    severity: 'error' as const,
    patterns: [{
      regex: /createReadStream|pipe\s*\(\s*res|res\.send\s*\(\s*file/gi,
      message: 'Direct file streaming through backend',
      suggestion: 'Use signed URLs for direct-to-storage uploads',
    }],
  },


  POLARIS_DEPRECATED: {
    name: 'polaris-deprecated',
    description: 'Deprecated Polaris component usage',
    severity: 'warning' as const,
    patterns: [{
      regex: /from\s+['"]@shopify\/polaris['"].*Stack|DisplayText|Heading|Subheading|Caption|TextStyle/g,
      message: 'Deprecated Polaris component detected',
      suggestion: 'Use BlockStack/InlineStack instead of Stack, Text instead of typography components',
    }],
  },


  APP_BRIDGE_OLD: {
    name: 'app-bridge-old',
    description: 'Old App Bridge usage',
    severity: 'warning' as const,
    patterns: [{
      regex: /@shopify\/app-bridge['"][^}]*(?!@shopify\/app-bridge-react)/g,
      message: 'Using @shopify/app-bridge directly',
      suggestion: 'Use @shopify/app-bridge-react for React apps',
    }, {
      regex: /createApp\s*\(/g,
      message: 'Legacy createApp() usage',
      suggestion: 'Use useAppBridge() hook from @shopify/app-bridge-react',
    }],
  },


  ENV_HARDCODED_SECRET: {
    name: 'env-hardcoded-secret',
    description: 'Hardcoded secret/key detected',
    severity: 'error' as const,
    patterns: [{
      regex: /(?:api[_-]?key|secret|token|password)\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
      message: 'Possible hardcoded secret detected',
      suggestion: 'Use environment variables for secrets',
    }],
  },


  NGINX_REFERENCE: {
    name: 'nginx-forbidden',
    description: 'NGINX reference detected (Caddy only)',
    severity: 'error' as const,
    patterns: [{
      regex: /nginx|Nginx|NGINX/g,
      message: 'NGINX reference found',
      suggestion: 'Project uses Caddy, not NGINX',
    }],
  },


  MANUAL_DEPLOY: {
    name: 'manual-deploy-forbidden',
    description: 'Manual deployment method detected',
    severity: 'error' as const,
    patterns: [{
      regex: /\bscp\b|\brsync\b|\bsftp\b|\bftp\b/gi,
      message: 'Manual deployment command detected',
      suggestion: 'Use GitHub → Server workflow only',
    }],
  },


  THEME_MISSING_LOCALES: {
    name: 'theme-missing-locales',
    description: 'Theme extension locale check',
    severity: 'warning' as const,
    filePattern: /extensions.*\.liquid$/,
    patterns: [{
      checkFn: (content: string) => {
        const hasT = content.includes('| t') || content.includes('| translate');
        const tKeys = content.match(/['"]([^'"]+)['"]\s*\|\s*t/g) || [];
        return tKeys.length > 0 ? null : null;
      },
    }],
  },






  POLARIS_V12_DEPRECATED: {
    name: 'polaris-v12-deprecated',
    description: 'Polaris v12+ deprecated components',
    severity: 'warning' as const,
    patterns: [{
      regex: /import\s*\{[^}]*(Stack|DisplayText|Heading|Subheading|Caption|TextStyle|VisuallyHidden)[^}]*\}\s*from\s*['"]@shopify\/polaris['"]/g,
      message: 'Deprecated Polaris component imported',
      suggestion: 'Stack→BlockStack/InlineStack, DisplayText/Heading/Subheading/Caption/TextStyle→Text',
    }, {
      regex: /<Stack\b/g,
      message: 'Stack component is deprecated in Polaris v12+',
      suggestion: 'Use <BlockStack> for vertical or <InlineStack> for horizontal layout',
    }, {
      regex: /<(DisplayText|Heading|Subheading|Caption|TextStyle)\b/g,
      message: 'Typography component is deprecated in Polaris v12+',
      suggestion: 'Use <Text variant="..."> instead',
    }, {
      regex: /<Card\s+sectioned\b/g,
      message: 'Card sectioned prop is deprecated',
      suggestion: 'Use <Card><BlockStack gap="400">...</BlockStack></Card>',
    }],
  },


  WEBHOOK_HMAC_CHECK: {
    name: 'webhook-hmac-required',
    description: 'Webhook handler must verify HMAC signature',
    severity: 'error' as const,
    filePattern: /webhooks\./,
    patterns: [{
      checkFn: (content: string) => {

        const isWebhookHandler = content.includes('ActionFunctionArgs') ||
                                  content.includes('export const action');
        if (!isWebhookHandler) return null;


        const hasAuthenticate = content.includes('authenticate.webhook') ||
                                content.includes('shopify.authenticate.webhook') ||
                                content.includes('verifyWebhook') ||
                                content.includes('HMAC');

        if (!hasAuthenticate) {
          return true;
        }
        return null;
      },
      message: 'Webhook handler may lack HMAC signature verification',
      suggestion: 'Use authenticate.webhook(request) from shopify.server.ts',
    }],
  },



  ENV_LEAK_CHECK: {
    name: 'env-leak',
    description: 'Environment variable leak in client code',
    severity: 'error' as const,

    filePattern: /extensions\/.*\.js$/,
    patterns: [{
      regex: /process\.env\.(SHOPIFY_API_SECRET|DATABASE_URL|REDIS_URL|R2_SECRET|AWS_SECRET)/g,
      message: 'Sensitive env variable in client code',
      suggestion: 'Never expose secrets in client-side code',
    }],
  },


  SECRET_LOG_CHECK: {
    name: 'secret-console-log',
    description: 'Logging sensitive data',
    severity: 'warning' as const,
    patterns: [{
      regex: /console\.log\s*\([^)]*(?:secret|password|apiKey|accessToken)/gi,
      message: 'Possible secret logged to console',
      suggestion: 'Remove console.log of sensitive data in production',
    }],
  },


  CREDENTIALS_SERIALIZE: {
    name: 'credentials-serialize',
    description: 'Credentials serialization in client-exposed code',
    severity: 'warning' as const,
    filePattern: /^(?!.*\.server\.).*\.(tsx?|jsx?|liquid)$/,
    patterns: [{
      regex: /JSON\.stringify\s*\([^)]*(?:session|credentials|auth)/gi,
      message: 'Possible credentials serialization',
      suggestion: 'Be careful not to expose sensitive session data',
    }],
  },


  APP_BRIDGE_MODERN: {
    name: 'app-bridge-modern',
    description: 'App Bridge modern patterns check',
    severity: 'warning' as const,
    patterns: [{
      regex: /import\s*\{[^}]*createApp[^}]*\}\s*from\s*['"]@shopify\/app-bridge['"]/g,
      message: 'Legacy App Bridge createApp import',
      suggestion: 'Use useAppBridge() hook from @shopify/app-bridge-react',
    }, {
      regex: /getSessionToken\s*\(/g,
      message: 'Manual session token handling',
      suggestion: 'Use authenticatedFetch or let Remix handle auth',
    }, {
      regex: /Redirect\.Action/g,
      message: 'Legacy Redirect action pattern',
      suggestion: 'Use navigate() from @shopify/app-bridge-react',
    }],
  },


  GRAPHQL_BEST_PRACTICES: {
    name: 'graphql-best-practices',
    description: 'GraphQL query best practices',
    severity: 'warning' as const,
    patterns: [{
      regex: /query\s*\{[^}]*\*[^}]*\}/g,
      message: 'Possible wildcard query - request only needed fields',
      suggestion: 'Specify exact fields needed in GraphQL query',
    }, {
      regex: /admin\.graphql\s*\(\s*`[^`]{2000,}`/g,
      message: 'Very long inline GraphQL query',
      suggestion: 'Consider moving to separate .graphql file or using fragments',
    }],
  },


  METAFIELD_NAMESPACE: {
    name: 'metafield-namespace',
    description: 'Metafield namespace should be app-specific',
    severity: 'info' as const,
    patterns: [{
      regex: /namespace:\s*['"](?!customizer|dtf|upload_studio)[a-z_]+['"]/g,
      message: 'Non-standard metafield namespace',
      suggestion: 'Use app-specific namespace: customizer, dtf, or upload_studio',
    }],
  },


  RATE_LIMIT_CHECK: {
    name: 'rate-limit-missing',
    description: 'API endpoint without rate limiting',
    severity: 'warning' as const,
    filePattern: /api\./,
    patterns: [{
      checkFn: (content: string) => {
        const isApiRoute = content.includes('export const action') ||
                           content.includes('export const loader');
        if (!isApiRoute) return null;

        const hasRateLimit = content.includes('rateLimit') ||
                             content.includes('RateLimit') ||
                             content.includes('throttle');


        if (content.includes('authenticate.admin')) return null;

        if (!hasRateLimit && content.includes('json(')) {
          return true;
        }
        return null;
      },
      message: 'Public API endpoint may lack rate limiting',
      suggestion: 'Add rate limiting for public endpoints',
    }],
  },


  PLUS_FEATURE_CHECK: {
    name: 'plus-feature-warning',
    description: 'Shopify Plus only feature usage',
    severity: 'info' as const,
    patterns: [{
      regex: /checkout\s*extension|CheckoutUI|ScriptTag|flowTrigger/gi,
      message: 'Shopify Plus feature detected',
      suggestion: 'This feature requires Shopify Plus plan',
    }],
  },


  LIQUID_SECURITY: {
    name: 'liquid-security',
    description: 'Liquid template security check',
    severity: 'error' as const,
    filePattern: /\.liquid$/,
    patterns: [{
      regex: /\{\{\s*[^}|]*\s*\}\}(?!\s*\|)/g,
      checkFn: (content: string) => {

        const unescaped = content.match(/\{\{\s*(?![\s'"0-9])[^}|]+\s*\}\}/g) || [];
        const dangerous = unescaped.filter(m =>
          !m.includes('| escape') &&
          !m.includes('| json') &&
          !m.includes('| url_encode') &&
          !m.includes('settings.') &&
          !m.includes('block.') &&
          !m.includes('section.') &&
          !m.includes('product.') &&
          !m.includes('shop.') &&
          !m.includes('cart.') &&
          !m.includes('customer.') &&
          !m.includes('request.') &&
          !m.includes('localization.') &&
          !m.includes('form.') &&
          !m.includes('forloop.') &&
          !m.includes('paginate.')
        );

        return dangerous.length > 10 ? true : null;
      },
      message: 'Multiple unescaped Liquid outputs detected',
      suggestion: 'Use | escape filter for user content, | json for data',
    }],
  },


  CORS_CHECK: {
    name: 'cors-security',
    description: 'CORS configuration check',
    severity: 'warning' as const,
    filePattern: /^(?!.*debug\.)(?!.*test\.).*routes.*\.tsx$/,
    patterns: [{
      regex: /Access-Control-Allow-Origin['":\s]+\*/g,
      message: 'Wildcard CORS origin detected',
      suggestion: 'Consider restricting to specific origins in production',
    }],
  },


  SQL_INJECTION: {
    name: 'sql-injection-risk',
    description: 'Potential SQL injection in raw queries',
    severity: 'error' as const,
    patterns: [{
      regex: /\$queryRaw\s*`[^`]*\$\{/g,
      message: 'Variable interpolation in raw SQL query',
      suggestion: 'Use Prisma.$queryRaw with Prisma.sql template tag',
    }, {
      regex: /\$executeRaw\s*`[^`]*\$\{/g,
      message: 'Variable interpolation in raw SQL execution',
      suggestion: 'Use parameterized queries to prevent SQL injection',
    }],
  },
};





function getAllFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!CONFIG.SKIP_DIRS.includes(item)) {
        getAllFiles(fullPath, files);
      }
    } else {
      const ext = extname(item);
      if (CONFIG.CHECK_EXTENSIONS.includes(ext) || CONFIG.CONFIG_FILES.includes(item)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function checkFile(filePath: string, content: string): void {
  const relativePath = relative(process.cwd(), filePath);
  const lines = content.split('\n');

  for (const [ruleName, rule] of Object.entries(RULES)) {
    if ('globalCheck' in rule && rule.globalCheck) continue;


    if ('filePattern' in rule && rule.filePattern) {
      if (!rule.filePattern.test(relativePath)) continue;
    }


    if (ruleName === 'API_VERSION_WRONG') {
      const versionRegex = /\/admin\/api\/(\d{4}-\d{2})\/graphql\.json/g;
      let match;
      while ((match = versionRegex.exec(content)) !== null) {
        const foundVersion = match[1];
        if (foundVersion !== CONFIG.REQUIRED_API_VERSION) {
          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;
          const line = lines[lineNumber - 1] || '';


          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

          results.push({
            file: relativePath,
            line: lineNumber,
            rule: 'api-version-wrong',
            severity: 'error',
            message: `Wrong API version: ${foundVersion} (required: ${CONFIG.REQUIRED_API_VERSION})`,
            suggestion: `Change ${foundVersion} to ${CONFIG.REQUIRED_API_VERSION}`,
          });
        }
      }
      continue;
    }

    for (const pattern of rule.patterns || []) {

      if ('checkFn' in pattern && pattern.checkFn) {
        const result = pattern.checkFn(content);
        if (result === true || (result !== null && result !== false)) {
          results.push({
            file: relativePath,
            line: 1,
            rule: rule.name,
            severity: rule.severity,
            message: pattern.message || rule.description,
            suggestion: pattern.suggestion,
          });
        }
        continue;
      }


      if ('regex' in pattern && pattern.regex) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match;

        while ((match = regex.exec(content)) !== null) {

          const beforeMatch = content.substring(0, match.index);
          const lineNumber = beforeMatch.split('\n').length;


          const line = lines[lineNumber - 1] || '';
          if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('#')) {
            continue;
          }

          results.push({
            file: relativePath,
            line: lineNumber,
            rule: rule.name,
            severity: rule.severity,
            message: pattern.message.replace(/\$1/g, match[1] || ''),
            suggestion: pattern.suggestion,
          });
        }
      }
    }
  }
}

function runGlobalChecks(allFiles: string[]): void {
  for (const [ruleName, rule] of Object.entries(RULES)) {
    if (!('globalCheck' in rule) || !rule.globalCheck) continue;

    if ('checkFn' in rule && rule.checkFn) {
      const result = rule.checkFn(allFiles);
      if (result) {
        results.push({
          file: 'project',
          line: 0,
          rule: rule.name,
          severity: rule.severity,
          message: result.message,
          suggestion: result.suggestion,
        });
      }
    }
  }
}

function checkConfigFiles(rootDir: string): void {

  const tomlFiles = ['shopify.app.toml', 'shopify.app.fdt.toml'];

  for (const tomlFile of tomlFiles) {
    const tomlPath = join(rootDir, tomlFile);
    if (!existsSync(tomlPath)) continue;

    const content = readFileSync(tomlPath, 'utf-8');
    const relativePath = relative(process.cwd(), tomlPath);


    const versionMatch = content.match(/api_version\s*=\s*["']?([^"'\s]+)["']?/);
    if (versionMatch) {
      const version = versionMatch[1];
      if (version !== CONFIG.REQUIRED_API_VERSION) {
        results.push({
          file: relativePath,
          line: content.substring(0, versionMatch.index).split('\n').length,
          rule: 'api-version-mismatch',
          severity: 'error',
          message: `API version ${version} does not match required ${CONFIG.REQUIRED_API_VERSION}`,
          suggestion: `Update api_version to "${CONFIG.REQUIRED_API_VERSION}"`,
        });
      } else {
        results.push({
          file: relativePath,
          line: content.substring(0, versionMatch.index).split('\n').length,
          rule: 'api-version-correct',
          severity: 'info',
          message: `✓ API version ${CONFIG.REQUIRED_API_VERSION} is correct`,
        });
      }
    }
  }


  const extensionDir = join(rootDir, 'extensions');
  if (existsSync(extensionDir)) {
    const extensionFiles = getAllFiles(extensionDir).filter(f => f.endsWith('.toml'));
    for (const extFile of extensionFiles) {
      const content = readFileSync(extFile, 'utf-8');
      const relativePath = relative(process.cwd(), extFile);

      const versionMatch = content.match(/api_version\s*=\s*["']?([^"'\s]+)["']?/);
      if (versionMatch && versionMatch[1] !== CONFIG.REQUIRED_API_VERSION) {
        results.push({
          file: relativePath,
          line: content.substring(0, versionMatch.index).split('\n').length,
          rule: 'extension-api-version',
          severity: 'error',
          message: `Extension API version ${versionMatch[1]} mismatch`,
          suggestion: `Update to ${CONFIG.REQUIRED_API_VERSION}`,
        });
      }
    }
  }
}





function printResults(): CheckSummary {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       🔍 SHOPIFY BEST PRACTICES CHECK                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const errors = results.filter(r => r.severity === 'error');
  const warnings = results.filter(r => r.severity === 'warning');
  const infos = results.filter(r => r.severity === 'info');


  if (errors.length > 0) {
    console.log('❌ ERRORS (' + errors.length + ')');
    console.log('─'.repeat(60));
    for (const error of errors) {
      console.log(`  ${error.file}:${error.line}`);
      console.log(`  └─ [${error.rule}] ${error.message}`);
      if (error.suggestion) {
        console.log(`     💡 ${error.suggestion}`);
      }
      console.log('');
    }
  }


  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS (' + warnings.length + ')');
    console.log('─'.repeat(60));
    for (const warning of warnings) {
      console.log(`  ${warning.file}:${warning.line}`);
      console.log(`  └─ [${warning.rule}] ${warning.message}`);
      if (warning.suggestion) {
        console.log(`     💡 ${warning.suggestion}`);
      }
      console.log('');
    }
  }


  if (infos.length > 0) {
    console.log('ℹ️  INFO (' + infos.length + ')');
    console.log('─'.repeat(60));
    for (const info of infos) {
      console.log(`  ${info.file}:${info.line} - ${info.message}`);
    }
    console.log('');
  }


  console.log('═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('─'.repeat(60));
  console.log(`  📁 Total Files:    ${totalFiles}`);
  console.log(`  🔍 Checked Files:  ${filesChecked}`);
  console.log(`  ❌ Errors:         ${errors.length}`);
  console.log(`  ⚠️  Warnings:       ${warnings.length}`);
  console.log(`  ℹ️  Info:           ${infos.length}`);
  console.log('');

  const passed = errors.length === 0;
  if (passed) {
    console.log('✅ All critical checks passed!');
  } else {
    console.log('❌ Critical errors found. Please fix before deploying.');
  }
  console.log('═'.repeat(60));
  console.log('');

  return {
    totalFiles,
    checkedFiles: filesChecked,
    errors: errors.length,
    warnings: warnings.length,
    infos: infos.length,
    passed,
  };
}





function main(): void {
  const rootDir = process.cwd();
  console.log(`\n🔍 Scanning: ${rootDir}`);
  console.log(`📌 Required API Version: ${CONFIG.REQUIRED_API_VERSION}`);


  let allFiles: string[] = [];
  for (const dir of CONFIG.SCAN_DIRS) {
    const dirPath = join(rootDir, dir);
    allFiles = allFiles.concat(getAllFiles(dirPath));
  }


  for (const configFile of CONFIG.CONFIG_FILES) {
    const configPath = join(rootDir, configFile);
    if (existsSync(configPath)) {
      allFiles.push(configPath);
    }
  }

  totalFiles = allFiles.length;
  console.log(`📁 Found ${totalFiles} files to check\n`);


  checkConfigFiles(rootDir);


  for (const file of allFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      checkFile(file, content);
      filesChecked++;
    } catch (error) {
      console.error(`Error reading ${file}: ${error}`);
    }
  }


  runGlobalChecks(allFiles);


  const summary = printResults();


  process.exit(summary.passed ? 0 : 1);
}

main();
