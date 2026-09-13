import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded, resetSeedGuard } from './db';
import { PRESETS } from './presets';
import { SEED_CATALOG, SEED_PROGRAMME_ID } from './seed';
import {
  archiveTemplate,
  createProgramme,
  createProgrammeFromPreset,
  createTemplate,
  deleteProgramme,
  duplicateProgramme,
  exportAll,
  getActiveProgramme,
  getProgramme,
  getSessionDetail,
  getTemplate,
  importMerge,
  listAllTemplates,
  listExercises,
  listProgrammes,
  listTemplates,
  reorderTemplates,
  setActiveProgramme,
  startSession,
  updateProgramme,
  updateTemplate,
  wipeAll,
} from './repo';
import { rotationShape } from '../logic/days';

beforeEach(async () => {
  resetSeedGuard();
  await wipeAll();
  await ensureSeeded();
});

/* --------------------------------------------------------------- the seed */

describe('seeded programme', () => {
  it('is one active Upper / Lower programme with the stock rotation', async () => {
    const programmes = await listProgrammes();
    expect(programmes).toHaveLength(1);
    expect(programmes[0]).toMatchObject({
      id: SEED_PROGRAMME_ID,
      name: 'Upper / Lower',
      active: true,
    });
    expect(rotationShape(programmes[0]!, await listTemplates())).toBe(
      'L · U · rest · L · U · rest · rest',
    );
  });

  it('gives every seeded day a programme and tags', async () => {
    const days = await listTemplates();
    expect(days.map((t) => t.id)).toEqual(['lowerA', 'upperA', 'lowerB', 'upperB']);
    expect(days.every((t) => t.programmeId === SEED_PROGRAMME_ID)).toBe(true);
    expect(days.map((t) => t.tags)).toEqual([
      ['lower', 'legs'],
      ['upper'],
      ['lower', 'legs'],
      ['upper'],
    ]);
  });

  it('is restored by wipeAll', async () => {
    await wipeAll();
    expect(await db.programmes.count()).toBe(1);
    expect((await getActiveProgramme()).id).toBe(SEED_PROGRAMME_ID);
    expect(await listTemplates()).toHaveLength(4);
  });
});

/* ------------------------------------------------------------- activation */

describe('the active programme', () => {
  it('self-heals when nothing carries the flag', async () => {
    await db.programmes.put({ ...(await getActiveProgramme()), active: false });
    const healed = await getActiveProgramme();
    expect(healed.active).toBe(true);
    expect((await db.programmes.get(healed.id))?.active).toBe(true);
  });

  it('promotes the newest non-archived programme when the flag is gone', async () => {
    const newer = await createProgramme('Newer');
    await db.programmes.put({ ...(await db.programmes.get(SEED_PROGRAMME_ID))!, active: false });
    expect((await getActiveProgramme()).id).toBe(newer.id);
  });

  it('throws only when there is no programme at all', async () => {
    await db.programmes.clear();
    await expect(getActiveProgramme()).rejects.toThrow(/No programme/);
  });

  it('keeps exactly one active row', async () => {
    const second = await createProgramme('Second');
    const third = await createProgramme('Third');
    await setActiveProgramme(second.id);
    let all = await listProgrammes();
    expect(all.filter((p) => p.active).map((p) => p.id)).toEqual([second.id]);

    await setActiveProgramme(third.id);
    all = await listProgrammes();
    expect(all.filter((p) => p.active).map((p) => p.id)).toEqual([third.id]);
    // Active first, then oldest to newest.
    expect(all.map((p) => p.id)).toEqual([third.id, SEED_PROGRAMME_ID, second.id]);
  });

  it('refuses to activate an unknown or archived programme', async () => {
    const spare = await createProgramme('Spare');
    await deleteProgramme(spare.id);
    await expect(setActiveProgramme(spare.id)).rejects.toThrow(/archived/);
    await expect(setActiveProgramme('nope')).rejects.toThrow(/Unknown programme/);
  });
});

/* ------------------------------------------------------------------- CRUD */

describe('programme CRUD', () => {
  it('creates an empty, inactive programme', async () => {
    const created = await createProgramme('  PPL bulk  ');
    expect(created).toMatchObject({ name: 'PPL bulk', rotation: [], active: false });
    expect(await getProgramme(created.id)).toMatchObject({ name: 'PPL bulk' });
    expect((await getActiveProgramme()).id).toBe(SEED_PROGRAMME_ID);
  });

  it('renames and rewrites the rotation', async () => {
    await updateProgramme(SEED_PROGRAMME_ID, {
      name: 'Cut',
      rotation: [{ templateId: 'upperA' }, { rest: true }, { templateId: 'lowerA' }],
    });
    const row = await getProgramme(SEED_PROGRAMME_ID);
    expect(row?.name).toBe('Cut');
    expect(row?.rotation).toEqual([
      { templateId: 'upperA' },
      { rest: true },
      { templateId: 'lowerA' },
    ]);
  });

  it('refuses a rotation slot that is not a live day of this programme', async () => {
    const other = await createProgramme('Other');
    const foreign = await createTemplate(other.id, { name: 'Foreign', tags: ['push'] });
    await expect(
      updateProgramme(SEED_PROGRAMME_ID, { rotation: [{ templateId: foreign.id }] }),
    ).rejects.toThrow(/unknown day/);
    await expect(
      updateProgramme(SEED_PROGRAMME_ID, { rotation: [{ templateId: 'ghost' }] }),
    ).rejects.toThrow(/unknown day/);
    // Nothing was written.
    expect((await getProgramme(SEED_PROGRAMME_ID))?.rotation).toHaveLength(7);
  });

  it('deep-copies a programme, its days and its exercises', async () => {
    const copy = await duplicateProgramme(SEED_PROGRAMME_ID, 'Upper / Lower cut');
    expect(copy.id).not.toBe(SEED_PROGRAMME_ID);
    expect(copy.active).toBe(false);
    expect(copy.name).toBe('Upper / Lower cut');

    const copiedDays = await listTemplates(copy.id);
    expect(copiedDays.map((t) => t.name)).toEqual(['Lower A', 'Upper A', 'Lower B', 'Upper B']);
    // Fresh ids all the way down.
    expect(copiedDays.some((t) => ['lowerA', 'upperA', 'lowerB', 'upperB'].includes(t.id))).toBe(
      false,
    );
    expect(copiedDays.every((t) => t.programmeId === copy.id)).toBe(true);

    const source = await listExercises('lowerA');
    const copied = await listExercises(copiedDays[0]!.id);
    expect(copied.map((e) => e.name)).toEqual(source.map((e) => e.name));
    expect(copied.map((e) => e.order)).toEqual(source.map((e) => e.order));
    expect(copied.some((e) => source.some((s) => s.id === e.id))).toBe(false);

    // The rotation points at the copies, and reads the same.
    expect(rotationShape(copy, copiedDays)).toBe('L · U · rest · L · U · rest · rest');
    const copiedIds = new Set(copiedDays.map((t) => t.id));
    for (const slot of copy.rotation) {
      if ('rest' in slot) continue;
      expect(copiedIds.has(slot.templateId)).toBe(true);
    }

    // Editing the copy leaves the original alone.
    await updateTemplate(copiedDays[0]!.id, { name: 'Legs' });
    expect((await getTemplate('lowerA'))?.name).toBe('Lower A');
  });

  it('refuses to delete the active programme', async () => {
    await expect(deleteProgramme(SEED_PROGRAMME_ID)).rejects.toThrow(/active programme/);
    expect(await listProgrammes()).toHaveLength(1);
  });

  it('archives a retired programme, its days and its exercises', async () => {
    const copy = await duplicateProgramme(SEED_PROGRAMME_ID, 'Spare');
    const days = await listTemplates(copy.id);
    await deleteProgramme(copy.id);

    expect((await getProgramme(copy.id))?.archived).toBe(true);
    expect(await listProgrammes()).toHaveLength(1);
    expect((await listProgrammes(true)).map((p) => p.id)).toContain(copy.id);

    expect(await listTemplates(copy.id)).toHaveLength(0);
    expect(await listTemplates(copy.id, true)).toHaveLength(days.length);
    expect(await listExercises(days[0]!.id)).toHaveLength(0);
    expect((await listExercises(days[0]!.id, true)).every((e) => e.archived)).toBe(true);

    // The seeded programme is untouched.
    expect(await listExercises('lowerA')).toHaveLength(7);
  });
});

/* -------------------------------------------------------------------- days */

describe('days', () => {
  it('appends a day to a programme', async () => {
    const created = await createTemplate(SEED_PROGRAMME_ID, {
      name: '  Arms  ',
      tags: ['upper', 'arms', 'arms'],
    });
    expect(created).toMatchObject({ name: 'Arms', tags: ['upper', 'arms'], order: 4 });
    expect((await listTemplates()).map((t) => t.id)).toEqual([
      'lowerA',
      'upperA',
      'lowerB',
      'upperB',
      created.id,
    ]);
  });

  it('renames and retags a day', async () => {
    await updateTemplate('lowerA', { name: 'Legs A', tags: ['lower', 'legs', 'legs'] });
    expect(await getTemplate('lowerA')).toMatchObject({
      name: 'Legs A',
      tags: ['lower', 'legs'],
    });
    await expect(updateTemplate('ghost', { name: 'x' })).rejects.toThrow(/Unknown day/);
  });

  it('reorders days, appending anything left out', async () => {
    await reorderTemplates(SEED_PROGRAMME_ID, ['upperB', 'lowerB']);
    expect((await listTemplates()).map((t) => t.id)).toEqual([
      'upperB',
      'lowerB',
      'lowerA',
      'upperA',
    ]);
  });

  it('archiving a day removes it from the rotation and archives its exercises', async () => {
    await archiveTemplate('upperA');

    expect((await getTemplate('upperA'))?.archived).toBe(true);
    expect((await listTemplates()).map((t) => t.id)).toEqual(['lowerA', 'lowerB', 'upperB']);
    expect((await listTemplates(SEED_PROGRAMME_ID, true))).toHaveLength(4);

    const programme = await getProgramme(SEED_PROGRAMME_ID);
    expect(programme?.rotation).toEqual([
      { templateId: 'lowerA' },
      { rest: true },
      { templateId: 'lowerB' },
      { templateId: 'upperB' },
      { rest: true },
      { rest: true },
    ]);

    expect(await listExercises('upperA')).toHaveLength(0);
    expect((await listExercises('upperA', true)).every((e) => e.archived)).toBe(true);
    // ...and the exercises are out of the programme-wide list too.
    expect(await listExercises()).toHaveLength(21);
  });

  it('listTemplates defaults to the active programme, listAllTemplates does not', async () => {
    const other = await createProgramme('Other');
    await createTemplate(other.id, { name: 'Foreign', tags: ['push'] });
    expect(await listTemplates()).toHaveLength(4);
    expect(await listTemplates(other.id)).toHaveLength(1);
    expect(await listAllTemplates()).toHaveLength(5);

    await setActiveProgramme(other.id);
    expect((await listTemplates()).map((t) => t.name)).toEqual(['Foreign']);
  });

  it('listExercises with no day means the active programme only', async () => {
    expect(await listExercises()).toHaveLength(28);
    const preset = await createProgrammeFromPreset('ppl_3', { activate: true });
    const days = await listTemplates(preset.id);
    const rows = await listExercises();
    // Three days of six, and nothing from the programme that is no longer active.
    expect(rows).toHaveLength(18);
    // In rotation order, then list order.
    expect(rows.map((e) => e.templateId).slice(0, 6)).toEqual(Array(6).fill(days[0]!.id));
  });
});

/* ----------------------------------------------------------------- presets */

describe('presets', () => {
  it('ships five, with unique ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'upper_lower_4',
      'ppl_6',
      'ppl_3',
      'full_body_3',
      'body_part_5',
    ]);
  });

  it('only ever names catalogue entries that exist', () => {
    const known = new Set(SEED_CATALOG.map((entry) => entry.id));
    for (const preset of PRESETS) {
      for (const day of preset.days) {
        for (const item of day.exercises) {
          expect(known.has(item.catalogId), `${preset.id}/${day.name}/${item.catalogId}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('gives every day 4-7 exercises, 1-4 sets each, primaries first', () => {
    for (const preset of PRESETS) {
      expect(preset.days.length).toBeGreaterThan(0);
      for (const day of preset.days) {
        expect(day.exercises.length).toBeGreaterThanOrEqual(4);
        expect(day.exercises.length).toBeLessThanOrEqual(7);
        expect(day.tags.length).toBeGreaterThan(0);
        for (const item of day.exercises) {
          expect(item.sets).toBeGreaterThanOrEqual(1);
          expect(item.sets).toBeLessThanOrEqual(4);
          expect(item.repMin).toBeLessThanOrEqual(item.repMax);
        }
        const lastPrimary = day.exercises.map((e) => e.type).lastIndexOf('primary');
        const firstAccessory = day.exercises.findIndex((e) => e.type !== 'primary');
        if (lastPrimary >= 0 && firstAccessory >= 0) {
          expect(lastPrimary).toBeLessThan(firstAccessory);
        }
      }
    }
  });

  it('points every rotation slot at a day it defines', () => {
    for (const preset of PRESETS) {
      for (const slot of preset.rotation) {
        if (slot === 'rest') continue;
        expect(preset.days[slot], `${preset.id}/${slot}`).toBeDefined();
      }
    }
  });

  it('builds a programme from a preset, inactive by default', async () => {
    const built = await createProgrammeFromPreset('ppl_6');
    expect(built.active).toBe(false);
    expect(built.name).toBe('Push / Pull / Legs 6-day');
    expect((await getActiveProgramme()).id).toBe(SEED_PROGRAMME_ID);

    const days = await listTemplates(built.id);
    expect(days.map((t) => t.name)).toEqual(['Push', 'Pull', 'Legs']);
    expect(days.map((t) => t.tags)).toEqual([
      ['upper', 'push'],
      ['upper', 'pull'],
      ['lower', 'legs'],
    ]);
    expect(built.rotation).toEqual([
      { templateId: days[0]!.id },
      { templateId: days[1]!.id },
      { templateId: days[2]!.id },
      { templateId: days[0]!.id },
      { templateId: days[1]!.id },
      { templateId: days[2]!.id },
      { rest: true },
    ]);
    expect(rotationShape(built, days)).toBe('P · P · L · P · P · L · rest');
  });

  it('takes the prescription from the preset and everything else from the catalogue', async () => {
    const built = await createProgrammeFromPreset('body_part_5');
    const days = await listTemplates(built.id);
    const chest = await listExercises(days[0]!.id);
    expect(chest.map((e) => e.name)).toEqual([
      'Barbell bench press',
      'Barbell incline bench',
      'DB flat bench',
      'Dips',
      'Cable fly',
    ]);
    expect(chest[0]).toMatchObject({
      catalogId: 'cat_barbell_bench_press',
      sets: 4,
      repMin: 6,
      repMax: 8,
      type: 'primary',
      // From the catalogue entry and Settings, not the preset.
      unit: 'kg_total',
      measure: 'reps',
      perSide: false,
      massUnit: 'kg',
      increment: 2.5,
    });
    // A bodyweight movement gets no increment.
    expect(chest.find((e) => e.catalogId === 'cat_dips')).toMatchObject({
      unit: 'bodyweight',
      increment: 0,
    });
  });

  it('builds every preset with the right number of days and exercises', async () => {
    for (const preset of PRESETS) {
      const built = await createProgrammeFromPreset(preset.id);
      const days = await listTemplates(built.id);
      expect(days).toHaveLength(preset.days.length);
      expect(built.rotation).toHaveLength(preset.rotation.length);
      for (const [index, day] of preset.days.entries()) {
        const rows = await listExercises(days[index]!.id);
        expect(rows, `${preset.id}/${day.name}`).toHaveLength(day.exercises.length);
        expect(rows.map((e) => e.catalogId)).toEqual(day.exercises.map((e) => e.catalogId));
        expect(rows.map((e) => e.sets)).toEqual(day.exercises.map((e) => e.sets));
        expect(rows.map((e) => e.repMin)).toEqual(day.exercises.map((e) => e.repMin));
        expect(rows.map((e) => e.repMax)).toEqual(day.exercises.map((e) => e.repMax));
      }
    }
  });

  it('can activate what it builds', async () => {
    const built = await createProgrammeFromPreset('full_body_3', { activate: true });
    expect(built.active).toBe(true);
    expect((await getActiveProgramme()).id).toBe(built.id);
    expect((await listProgrammes()).filter((p) => p.active)).toHaveLength(1);
    expect((await listTemplates()).map((t) => t.name)).toEqual([
      'Full body A',
      'Full body B',
      'Full body C',
    ]);
  });

  it('throws on an unknown preset', async () => {
    await expect(createProgrammeFromPreset('nope')).rejects.toThrow(/Unknown preset/);
  });
});

/* ---------------------------------------------------------------- sessions */

describe('startSession snapshots', () => {
  it('freezes the day name, programme and rotation slot', async () => {
    const session = await startSession('lowerB', { slotIndex: 3, startedAt: 1_700 });
    expect(session).toMatchObject({
      templateId: 'lowerB',
      templateName: 'Lower B',
      programmeId: SEED_PROGRAMME_ID,
      slotIndex: 3,
      startedAt: 1_700,
    });
    expect(session.exercises).toHaveLength(7);

    // A later rename never rewrites what the session says.
    await updateTemplate('lowerB', { name: 'Hinge day' });
    const detail = await getSessionDetail(session.id);
    expect(detail?.templateName).toBe('Lower B');
    expect(detail?.template?.name).toBe('Hinge day');
  });

  it('omits slotIndex when there is none to record', async () => {
    const session = await startSession('lowerA');
    expect('slotIndex' in session).toBe(false);
    expect(await startSession('lowerA', { slotIndex: -1 })).not.toHaveProperty('slotIndex');
  });

  it('still accepts the old positional (templateId, startedAt) call', async () => {
    const session = await startSession('upperA', 4_242);
    expect(session.startedAt).toBe(4_242);
    expect(session.templateName).toBe('Upper A');
    expect(session.slotIndex).toBeUndefined();
  });

  it('falls back to the live day, then the id, when there is no snapshot', async () => {
    await db.sessions.put({ id: 'bare', templateId: 'upperB', startedAt: 10 });
    expect((await getSessionDetail('bare'))?.templateName).toBe('Upper B');
    await db.sessions.put({ id: 'orphan', templateId: 'vanished', startedAt: 10 });
    expect((await getSessionDetail('orphan'))?.templateName).toBe('vanished');
  });
});

/* ----------------------------------------------------------- export/import */

describe('backup with programmes', () => {
  it('exports them', async () => {
    const bundle = await exportAll();
    expect(bundle.programmes?.map((p) => p.id)).toEqual([SEED_PROGRAMME_ID]);
  });

  it('imports a v3 bundle, programmes included', async () => {
    const counts = await importMerge({
      programmes: [
        {
          id: 'p_imported',
          name: 'Imported',
          rotation: [{ templateId: 't_imported' }, { rest: true }],
          active: false,
          createdAt: 1,
        },
        { id: 'p_bad', name: 'No rotation' },
      ],
      templates: [
        {
          id: 't_imported',
          programmeId: 'p_imported',
          name: 'Imported day',
          tags: ['push'],
          order: 0,
        },
      ],
    });
    expect(counts.programmes).toBe(1);
    expect(counts.templates).toBe(1);
    expect(counts.skipped).toBe(1);
    expect((await getProgramme('p_imported'))?.rotation).toHaveLength(2);
    expect(await listTemplates('p_imported')).toHaveLength(1);
  });

  it('adopts a v2 bundle: no programmes, days carrying a kind', async () => {
    const counts = await importMerge({
      version: 1,
      exportedAt: 1,
      templates: [
        { id: 'v2_lower', name: 'Old lower', kind: 'lower', order: 9 },
        { id: 'v2_upper', name: 'Old upper', kind: 'upper', order: 10 },
      ],
      exercises: [],
      sessions: [{ id: 'v2_sess', templateId: 'v2_lower', startedAt: 5, finishedAt: 6 }],
      setLogs: [],
      settings: [],
      bodyweight: [],
    });
    expect(counts.programmes).toBe(0);
    expect(counts.templates).toBe(2);
    expect(counts.sessions).toBe(1);

    const lower = await getTemplate('v2_lower');
    expect(lower).toMatchObject({
      programmeId: SEED_PROGRAMME_ID,
      tags: ['lower', 'legs'],
      name: 'Old lower',
    });
    expect('kind' in lower!).toBe(false);
    expect((await getTemplate('v2_upper'))?.tags).toEqual(['upper']);
    // They joined the active programme, so they show up in its day list.
    expect((await listTemplates()).map((t) => t.id)).toContain('v2_lower');
  });

  it('never overwrites a row that is already there', async () => {
    await importMerge({
      programmes: [
        {
          id: SEED_PROGRAMME_ID,
          name: 'Hijacked',
          rotation: [],
          active: true,
          createdAt: 1,
        },
      ],
      templates: [{ id: 'lowerA', name: 'Hijacked day', kind: 'upper', order: 0 }],
    });
    expect((await getProgramme(SEED_PROGRAMME_ID))?.name).toBe('Upper / Lower');
    expect((await getTemplate('lowerA'))?.name).toBe('Lower A');
  });
});
