import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { MISSION_FIELDS } from '../src/constants/missions.js';

const userId = 'c0d23f6c-5901-42a3-b7ef-d7305d26e406';

async function createHarness(initialProfile = null, writeError = null) {
  const profiles = new Map(initialProfile ? [[initialProfile.id, { ...initialProfile }]] : []);
  const writes = [];
  const supabaseAdmin = {
    from(table) {
      assert.equal(table, 'user_profiles');
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              return {
                async maybeSingle() {
                  return { data: profiles.get(value) ?? null, error: null };
                },
              };
            },
          };
        },
        async upsert(rows, options) {
          assert.equal(options.onConflict, 'id');
          assert.equal(rows.length, 1);
          const row = rows[0];
          writes.push({ ...row });
          if (writeError) return { error: writeError };
          if (!row.id) return { error: new Error('user_profiles.id must not be null') };
          profiles.set(row.id, { ...profiles.get(row.id), ...row });
          return { error: null };
        },
      };
    },
  };
  const context = createContext({});
  const supabaseModule = new SyntheticModule(['supabaseAdmin'], function () {
    this.setExport('supabaseAdmin', supabaseAdmin);
  }, { context });
  const missionsModule = new SyntheticModule(['MISSION_FIELDS'], function () {
    this.setExport('MISSION_FIELDS', MISSION_FIELDS);
  }, { context });
  const source = await readFile(new URL('../src/services/guestMigrationService.js', import.meta.url), 'utf8');
  const service = new SourceTextModule(source, { context });
  await service.link((specifier) => {
    if (specifier === '../config/supabase.js') return supabaseModule;
    if (specifier === '../constants/missions.js') return missionsModule;
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await service.evaluate();
  return { migrate: service.namespace.migrateGuestDataToUser, profiles, writes };
}

test('existing profile upsert includes the authenticated user ID', async () => {
  const h = await createHarness({ id: userId, onboarding_data: null, units_preference: 'metric' });
  const result = await h.migrate(userId, { onboardingData: { goal: 'guest' } });

  assert.equal(result.migrated, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].id, userId);
  assert.equal(h.profiles.get(userId).onboarding_data.goal, 'guest');
});

test('missing profile is inserted with the authenticated user ID', async () => {
  const h = await createHarness();
  await h.migrate(userId, { onboardingData: { goal: 'guest' }, unitsPreference: 'imperial' });

  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].id, userId);
  assert.equal(h.profiles.get(userId).onboarding_data.goal, 'guest');
  assert.equal(h.profiles.get(userId).units_preference, 'imperial');
});

test('existing onboarding is preserved while missing units are migrated', async () => {
  const onboarding = { goal: 'account' };
  const h = await createHarness({ id: userId, onboarding_data: onboarding, units_preference: null });
  await h.migrate(userId, { onboardingData: { goal: 'guest' }, unitsPreference: 'imperial' });

  assert.equal(h.writes[0].id, userId);
  assert.equal('onboarding_data' in h.writes[0], false);
  assert.equal(h.profiles.get(userId).onboarding_data, onboarding);
  assert.equal(h.profiles.get(userId).units_preference, 'imperial');
});

test('existing units are preserved while missing onboarding is migrated', async () => {
  const h = await createHarness({
    id: userId, onboarding_data: null, units_preference: 'metric', display_name: 'account',
  });
  await h.migrate(userId, { onboardingData: { goal: 'guest' }, unitsPreference: 'imperial' });

  assert.equal(h.writes[0].id, userId);
  assert.equal('units_preference' in h.writes[0], false);
  assert.equal(h.profiles.get(userId).units_preference, 'metric');
  assert.equal(h.profiles.get(userId).display_name, 'account');
});

test('existing onboarding and units are unchanged when already populated', async () => {
  const onboarding = { goal: 'account' };
  const h = await createHarness({ id: userId, onboarding_data: onboarding, units_preference: 'metric' });
  const result = await h.migrate(userId, { onboardingData: { goal: 'guest' }, unitsPreference: 'imperial' });

  assert.equal(result.stats.profileUpdated, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.profiles.get(userId).onboarding_data, onboarding);
  assert.equal(h.profiles.get(userId).units_preference, 'metric');
});

test('profile database write errors propagate', async () => {
  const error = new Error('database write failed');
  const h = await createHarness({ id: userId, onboarding_data: null, units_preference: 'metric' }, error);

  await assert.rejects(h.migrate(userId, { onboardingData: { goal: 'guest' } }), (actual) => actual === error);
  assert.equal(h.profiles.get(userId).onboarding_data, null);
});

test('repeated migration does not create duplicate profiles', async () => {
  const h = await createHarness();
  const payload = { onboardingData: { goal: 'guest' }, unitsPreference: 'imperial' };
  await h.migrate(userId, payload);
  await h.migrate(userId, payload);

  assert.equal(h.profiles.size, 1);
  assert.equal(h.writes.length, 1);
  assert.equal(h.profiles.get(userId).onboarding_data.goal, 'guest');
  assert.equal(h.profiles.get(userId).units_preference, 'imperial');
});
