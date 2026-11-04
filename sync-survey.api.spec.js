
// Playwright API Test for POST /sync-survey - Handles duplicate local IDs
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://mock-api.example.com';

// Mock payloads - Ankit and Pooja both use School_1 locally
const ankitPayload = {
  localId: "School_1",
  deviceId: "device_ankit_123",
  timestamp: "2026-11-04T10:00:00Z",
  schoolName: "Govt Primary School",
  village: "Nilagiri",
  gps: { lat: 21.45, lng: 86.77 },
  surveyData: { q_1: "Ram", q_2: "3rd" }
};

const poojaPayload = {
  localId: "School_1", // Same localId collision!
  deviceId: "device_pooja_456",
  timestamp: "2026-11-04T11:00:00Z",
  schoolName: "Govt Primary School",
  village: "Nilagiri",
  gps: { lat: 21.46, lng: 86.78 },
  surveyData: { q_1: "Govt Primary School", q_2: "4th" }
};

test.describe('POST /sync-survey - Offline Sync & Collision', () => {

  test('should not overwrite when two devices send same localId', async ({ request }) => {
    const idempotencyKeyAnkit = `ankit-${Date.now()}`;
    const idempotencyKeyPooja = `pooja-${Date.now()}`;

    const res1 = await request.post(`${BASE_URL}/sync-survey`, {
      headers: { 'Idempotency-Key': idempotencyKeyAnkit, 'Content-Type': 'application/json' },
      data: ankitPayload
    });
    expect(res1.status()).toBe(201);
    const body1 = await res1.json();
    expect(body1.serverId).toBeDefined();
    expect(body1.localId).toBe("School_1");

    const res2 = await request.post(`${BASE_URL}/sync-survey`, {
      headers: { 'Idempotency-Key': idempotencyKeyPooja, 'Content-Type': 'application/json' },
      data: poojaPayload
    });
    expect(res2.status()).toBe(201);
    const body2 = await res2.json();

    // Critical assertion: serverIds must be different, no overwrite
    expect(body2.serverId).not.toBe(body1.serverId);
    expect(body2.status).toBe('created_or_flagged_for_review');
  });

  test('idempotency - same request replay should return same serverId', async ({ request }) => {
    const key = `test-idemp-${Date.now()}`;
    const res1 = await request.post(`${BASE_URL}/sync-survey`, {
      headers: { 'Idempotency-Key': key },
      data: ankitPayload
    });
    const body1 = await res1.json();
    const res2 = await request.post(`${BASE_URL}/sync-survey`, {
      headers: { 'Idempotency-Key': key },
      data: ankitPayload
    });
    const body2 = await res2.json();
    expect(body1.serverId).toBe(body2.serverId);
  });

  test('DDoS simulation - 50 parallel syncs should not 500', async ({ request }) => {
    const promises = Array.from({ length: 50 }, (_, i) => 
      request.post(`${BASE_URL}/sync-survey`, {
        headers: { 'Idempotency-Key': `load-${i}-${Date.now()}` },
        data: { ...ankitPayload, deviceId: `load_device_${i}`, localId: `School_${i}` }
      })
    );
    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status());
    const serverErrors = statuses.filter(s => s >= 500);
    expect(serverErrors.length).toBe(0); // Should be 201 or 429, not 500
  });
});
