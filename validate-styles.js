#!/usr/bin/env node

/**
 * Style Consistency Validator
 *
 * Checks that all HTML prototypes use only design system tokens.
 * Catches: hardcoded colors, inline styles, wrong fonts, rogue shadows.
 *
 * Usage: node validate-styles.js
 * Exit code: 0 = clean, 1 = violations found
 */

const fs = require('fs');
const path = require('path');

// ── Extract design tokens from styles.css ──

function extractTokens(cssFile) {
  const css = fs.readFileSync(cssFile, 'utf8');
  const tokens = { colors: new Set(), fonts: [], radii: [], shadows: [] };

  // Extract CSS custom property values from :root
  const rootBlock = css.match(/:root\s*\{([^}]+)\}/s);
  if (!rootBlock) return tokens;

  const props = rootBlock[1];

  // Colors: any #hex value in :root
  const hexMatches = props.matchAll(/#[0-9A-Fa-f]{3,8}/g);
  for (const m of hexMatches) {
    tokens.colors.add(m[0].toUpperCase());
  }

  // Also add common derived colors
  tokens.colors.add('#FFF');
  tokens.colors.add('#FFFFFF');
  tokens.colors.add('#000');
  tokens.colors.add('#000000');
  tokens.colors.add('#EEE');
  tokens.colors.add('#EEEEEE');

  return tokens;
}

// ── Scan HTML files ──

function scanHTML(filePath, tokens) {
  const html = fs.readFileSync(filePath, 'utf8');
  const violations = [];
  const fileName = path.basename(filePath);

  // 1. Check for inline style attributes with hardcoded colors
  const styleAttrRegex = /style\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = styleAttrRegex.exec(html)) !== null) {
    const styleValue = match[1];
    const lineNum = html.substring(0, match.index).split('\n').length;

    // Find hardcoded hex colors in inline styles
    const hexInStyle = styleValue.matchAll(/#[0-9A-Fa-f]{3,8}/g);
    for (const hex of hexInStyle) {
      const color = hex[0].toUpperCase();
      if (!tokens.colors.has(color)) {
        violations.push({
          file: fileName,
          line: lineNum,
          type: 'UNKNOWN_COLOR',
          value: hex[0],
          message: `Hardcoded color ${hex[0]} not in design system palette`
        });
      }
    }

    // Find rgb/rgba colors (should use CSS vars instead)
    if (/rgba?\s*\(/.test(styleValue)) {
      violations.push({
        file: fileName,
        line: lineNum,
        type: 'RGB_COLOR',
        value: styleValue.match(/rgba?\s*\([^)]+\)/)[0],
        message: 'Use CSS custom properties instead of rgb/rgba'
      });
    }

    // Check for hardcoded font-family (should use var or inherit)
    if (/font-family\s*:/.test(styleValue) && !styleValue.includes('var(')) {
      violations.push({
        file: fileName,
        line: lineNum,
        type: 'HARDCODED_FONT',
        value: styleValue.match(/font-family\s*:[^;]+/)[0],
        message: 'Font should come from styles.css, not inline'
      });
    }

    // Check for hardcoded box-shadow (should use var(--shadow-*))
    if (/box-shadow\s*:/.test(styleValue) && !styleValue.includes('var(')) {
      violations.push({
        file: fileName,
        line: lineNum,
        type: 'HARDCODED_SHADOW',
        value: styleValue.match(/box-shadow\s*:[^;]+/)[0],
        message: 'Use var(--shadow-sm/md/lg) instead of hardcoded shadow'
      });
    }

    // Check for hardcoded border-radius (should use var(--radius-*))
    if (/border-radius\s*:/.test(styleValue) && !styleValue.includes('var(')) {
      const radiusMatch = styleValue.match(/border-radius\s*:\s*([^;]+)/);
      if (radiusMatch) {
        const val = radiusMatch[1].trim();
        // Allow 0, 50%, and small structural values in brandbook
        if (!['0', '50%', '0px'].includes(val)) {
          violations.push({
            file: fileName,
            line: lineNum,
            type: 'HARDCODED_RADIUS',
            value: radiusMatch[0],
            message: 'Use var(--radius-sm/md/lg/xl/full) instead'
          });
        }
      }
    }
  }

  // 2. Check <style> blocks for hardcoded colors outside :root
  const styleBlocks = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const block of styleBlocks) {
    const css = block[1];
    const blockStart = html.substring(0, block.index).split('\n').length;

    // Find hex colors that aren't in var() declarations or comments
    const lines = css.split('\n');
    lines.forEach((line, i) => {
      // Skip lines that define CSS variables
      if (line.includes('--') && line.includes(':')) return;
      // Skip comments
      if (line.trim().startsWith('/*') || line.trim().startsWith('//')) return;

      const hexColors = line.matchAll(/#[0-9A-Fa-f]{3,8}(?![0-9A-Fa-f])/g);
      for (const hex of hexColors) {
        const color = hex[0].toUpperCase();
        if (!tokens.colors.has(color)) {
          violations.push({
            file: fileName,
            line: blockStart + i,
            type: 'UNKNOWN_COLOR_IN_STYLE',
            value: hex[0],
            message: `Color ${hex[0]} in <style> block not in design system`
          });
        }
      }
    });
  }

  // 3. Check that styles.css and components.css are loaded
  if (!html.includes('styles.css')) {
    violations.push({
      file: fileName, line: 0,
      type: 'MISSING_STYLESHEET',
      value: 'styles.css',
      message: 'Must include styles.css for design system tokens'
    });
  }
  if (!html.includes('components.css')) {
    violations.push({
      file: fileName, line: 0,
      type: 'MISSING_STYLESHEET',
      value: 'components.css',
      message: 'Must include components.css for shared components'
    });
  }

  // 4. Check for Space Grotesk font import
  if (!html.includes('Space+Grotesk') && !html.includes('Space Grotesk')) {
    violations.push({
      file: fileName, line: 0,
      type: 'MISSING_FONT',
      value: 'Space Grotesk',
      message: 'Must import Space Grotesk from Google Fonts'
    });
  }

  return violations;
}

// ── Main ──

function main() {
  const dir = __dirname;
  const stylesPath = path.join(dir, 'styles.css');

  if (!fs.existsSync(stylesPath)) {
    console.error('ERROR: styles.css not found');
    process.exit(1);
  }

  const tokens = extractTokens(stylesPath);
  console.log(`Design system: ${tokens.colors.size} colors in palette\n`);

  // Find all HTML files (exclude node_modules, .github)
  const htmlFiles = fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(dir, f));

  if (htmlFiles.length === 0) {
    console.log('No HTML files found.');
    process.exit(0);
  }

  let totalViolations = 0;
  const results = {};

  // Exempt files: brandbook (reference) and wireframes (no brand styles by design)
  const exemptFiles = ['brandbook.html'];
  const exemptPrefixes = ['wireframe-'];

  for (const file of htmlFiles) {
    const fileName = path.basename(file);

    if (exemptFiles.includes(fileName)) {
      console.log(`✓ ${fileName} (exempt — reference page)`);
      continue;
    }

    if (exemptPrefixes.some(p => fileName.startsWith(p))) {
      console.log(`✓ ${fileName} (exempt — wireframe, no brand styles)`);
      continue;
    }

    const violations = scanHTML(file, tokens);
    results[fileName] = violations;

    if (violations.length === 0) {
      console.log(`✓ ${fileName}`);
    } else {
      console.log(`✗ ${fileName} — ${violations.length} violation(s):`);
      for (const v of violations) {
        const line = v.line > 0 ? `:${v.line}` : '';
        console.log(`  [${v.type}] ${v.file}${line} → ${v.message}`);
        if (v.value) console.log(`    value: ${v.value}`);
      }
      totalViolations += violations.length;
    }
    console.log('');
  }

  // Summary
  console.log('─'.repeat(50));
  if (totalViolations === 0) {
    console.log(`\n✓ ALL CLEAN — ${htmlFiles.length} files, 0 violations\n`);
    console.log('All prototypes conform to the design system.');
    process.exit(0);
  } else {
    console.log(`\n✗ ${totalViolations} violation(s) in ${Object.keys(results).filter(k => results[k].length > 0).length} file(s)\n`);
    console.log('Fix violations to ensure brand consistency.');
    process.exit(1);
  }
}

main();
