import { getAuthContext } from '../_lib/supabase.js';
import { getGa4Traffic, isGa4Configured } from '../_lib/ga4.js';

function json(res, status, payload) {
  res.status(status).json(payload);
}

function parseRange(req) {
  const raw = String(req.query?.range || '7d').toLowerCase();
  if (raw === '30d') return { label: '30d', days: 30 };
  return { label: '7d', days: 7 };
}

function startDateForDays(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date.toISOString();
}

function normalizeBusinessMetrics(row) {
  return {
    totalUsers: Number(row?.total_users || 0),
    rangeUsers: Number(row?.range_users || 0),
    superAdmins: Number(row?.super_admins || 0),
    activeMemberships: Number(row?.active_memberships || 0),
    totalCreditBalance: Number(row?.total_credit_balance || 0),
    totalGenerations: Number(row?.total_generations || 0),
    rangeGenerations: Number(row?.range_generations || 0),
    succeededGenerations: Number(row?.succeeded_generations || 0),
    failedGenerations: Number(row?.failed_generations || 0),
    pendingGenerations: Number(row?.pending_generations || 0),
    rangeSucceededGenerations: Number(row?.range_succeeded_generations || 0),
    totalGenerationCredits: Number(row?.total_generation_credits || 0),
    rangeGenerationCredits: Number(row?.range_generation_credits || 0),
    purchasedCredits: Number(row?.purchased_credits || 0),
    membershipCredits: Number(row?.membership_credits || 0)
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await getAuthContext(req);
  if (auth.error) {
    return json(res, auth.status || 401, { ok: false, error: auth.error });
  }

  if (!auth.profile?.isSuperAdmin) {
    return json(res, 403, { ok: false, error: 'FORBIDDEN' });
  }

  const range = parseRange(req);
  const startAt = startDateForDays(range.days);

  try {
    const [businessResult, trafficResult] = await Promise.allSettled([
      auth.client.rpc('get_admin_dashboard_metrics', { p_start_at: startAt }),
      getGa4Traffic(range.days)
    ]);

    if (businessResult.status === 'rejected' || businessResult.value?.error) {
      throw businessResult.reason || businessResult.value?.error;
    }

    const businessRow = Array.isArray(businessResult.value.data)
      ? businessResult.value.data[0]
      : businessResult.value.data;

    const traffic = trafficResult.status === 'fulfilled'
      ? trafficResult.value
      : {
          configured: isGa4Configured(),
          error: 'GA4_REPORT_FAILED',
          totals: null,
          daily: [],
          topPages: [],
          channels: [],
          countries: []
        };

    return json(res, 200, {
      ok: true,
      range: range.label,
      business: normalizeBusinessMetrics(businessRow),
      traffic
    });
  } catch (error) {
    console.warn('Failed to load admin metrics', {
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }
}
