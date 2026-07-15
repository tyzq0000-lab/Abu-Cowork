import { describe, it, expect } from 'vitest';
import { parseDeepLink, isDownloadUrlAllowed, isEnrollmentUrlAllowed, ALLOWED_DOWNLOAD_HOSTS } from './parser';

const OSS = ALLOWED_DOWNLOAD_HOSTS[0];

describe('deeplink parser', () => {
  describe('parseDeepLink', () => {
    it('parses a valid employee install link', () => {
      const pkgUrl = `https://${OSS}/employees/new-media-ops.zip`;
      const raw = `fuyao://install?type=employee&url=${encodeURIComponent(pkgUrl)}&name=${encodeURIComponent('运小运')}`;
      const result = parseDeepLink(raw);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.request).toEqual({
          action: 'install',
          pkgType: 'employee',
          url: pkgUrl,
          name: '运小运',
        });
      }
    });

    it('parses a valid skill install link without a name', () => {
      const pkgUrl = `https://${OSS}/skills/report.askill`;
      const result = parseDeepLink(`fuyao://install?type=skill&url=${encodeURIComponent(pkgUrl)}`);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.request.pkgType).toBe('skill');
        expect(result.request.name).toBeUndefined();
      }
    });

    it('preserves generic platform deployment context', () => {
      const pkgUrl = `https://${OSS}/employees/generic-package.zip`;
      const result = parseDeepLink(
        `fuyao://install?type=employee&url=${encodeURIComponent(pkgUrl)}`
        + '&employeeId=employee-42&hireId=hire-42&packageId=generic-package'
        + '&packageVersion=1.2.3&launchTarget=conversation&integrity=required'
        + '&enrollmentCode=upr_enr_abcdefghijklmnopqrstuvwxyz123456'
        + `&enrollmentUrl=${encodeURIComponent('http://127.0.0.1:3001/api/deployments/exchange')}`,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.request).toEqual({
          action: 'install',
          pkgType: 'employee',
          url: pkgUrl,
          employeeId: 'employee-42',
          hireId: 'hire-42',
          packageId: 'generic-package',
          packageVersion: '1.2.3',
          integrityRequired: true,
          enrollmentCode: 'upr_enr_abcdefghijklmnopqrstuvwxyz123456',
          enrollmentUrl: 'http://127.0.0.1:3001/api/deployments/exchange',
          launchTarget: 'conversation',
        });
      }
    });

    it('tolerates a trailing slash after the action (Windows URL normalization)', () => {
      const pkgUrl = `https://${OSS}/a.zip`;
      const result = parseDeepLink(`fuyao://install/?type=employee&url=${encodeURIComponent(pkgUrl)}`);
      expect(result.ok).toBe(true);
    });

    it('rejects non-URL input', () => {
      const result = parseDeepLink('not a url at all');
      expect(result).toMatchObject({ ok: false, code: 'INVALID_URL' });
    });

    it('rejects other schemes', () => {
      const result = parseDeepLink('https://example.com/?type=employee&url=x');
      expect(result).toMatchObject({ ok: false, code: 'WRONG_SCHEME' });
    });

    it('rejects unknown actions', () => {
      const result = parseDeepLink('fuyao://selfdestruct?type=employee&url=x');
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    });

    it('rejects missing or invalid package type', () => {
      const pkgUrl = encodeURIComponent(`https://${OSS}/a.zip`);
      expect(parseDeepLink(`fuyao://install?url=${pkgUrl}`)).toMatchObject({ ok: false, code: 'INVALID_TYPE' });
      expect(parseDeepLink(`fuyao://install?type=malware&url=${pkgUrl}`)).toMatchObject({ ok: false, code: 'INVALID_TYPE' });
    });

    it('rejects a missing download url', () => {
      const result = parseDeepLink('fuyao://install?type=employee');
      expect(result).toMatchObject({ ok: false, code: 'MISSING_URL' });
    });

    it('rejects download hosts outside the allowlist', () => {
      const result = parseDeepLink(
        `fuyao://install?type=employee&url=${encodeURIComponent('https://evil.example.com/pwn.zip')}`,
      );
      expect(result).toMatchObject({ ok: false, code: 'URL_NOT_ALLOWED' });
    });

    it('rejects missing, partial, malformed, or unpinned enrollment context', () => {
      const pkgUrl = encodeURIComponent(`https://${OSS}/employees/a.zip`);
      const base = `fuyao://install?type=employee&url=${pkgUrl}&employeeId=emp_1&hireId=hire_1&integrity=required`;
      expect(parseDeepLink(base)).toMatchObject({ ok: false, code: 'INVALID_ENROLLMENT' });
      expect(parseDeepLink(`${base}&enrollmentCode=upr_enr_abcdefghijklmnopqrstuvwxyz123456`))
        .toMatchObject({ ok: false, code: 'INVALID_ENROLLMENT' });
      expect(parseDeepLink(
        `${base}&enrollmentCode=short&enrollmentUrl=${encodeURIComponent('https://evil.example.com/api/deployments/exchange')}`,
      )).toMatchObject({ ok: false, code: 'INVALID_ENROLLMENT' });
    });
  });

  describe('isDownloadUrlAllowed', () => {
    it('allows https on allowlisted hosts only', () => {
      expect(isDownloadUrlAllowed(`https://${OSS}/x.zip`)).toBe(true);
      expect(isDownloadUrlAllowed('https://evil.example.com/x.zip')).toBe(false);
      // subdomain of an allowlisted host is NOT allowed (exact match)
      expect(isDownloadUrlAllowed(`https://sub.${OSS}/x.zip`)).toBe(false);
    });

    it('allows plain http only for localhost dev hosts', () => {
      expect(isDownloadUrlAllowed('http://localhost:8000/x.zip')).toBe(true);
      expect(isDownloadUrlAllowed('http://127.0.0.1:8000/x.zip')).toBe(true);
      expect(isDownloadUrlAllowed(`http://${OSS}/x.zip`)).toBe(false);
    });

    it('rejects non-http(s) protocols and garbage', () => {
      expect(isDownloadUrlAllowed('file:///etc/passwd')).toBe(false);
      expect(isDownloadUrlAllowed('ftp://example.com/x.zip')).toBe(false);
      expect(isDownloadUrlAllowed('::::')).toBe(false);
    });
  });

  describe('isEnrollmentUrlAllowed', () => {
    it('allows loopback HTTP for development and rejects arbitrary HTTPS hosts', () => {
      expect(isEnrollmentUrlAllowed('http://127.0.0.1:3001/api/deployments/exchange')).toBe(true);
      expect(isEnrollmentUrlAllowed('http://localhost:3001/api/deployments/exchange')).toBe(true);
      expect(isEnrollmentUrlAllowed('https://evil.example.com/api/deployments/exchange')).toBe(false);
      expect(isEnrollmentUrlAllowed('file:///tmp/exchange')).toBe(false);
    });
  });
});
