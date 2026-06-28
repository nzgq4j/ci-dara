import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import {
  seedBuiltinPersonas,
  PERSONA_TEMPLATE_VARS
} from '@/utils/dara/personas';
import { recordAudit } from '@/utils/dara/audit';
import PageHeader from '@/components/dara/PageHeader';
import {
  card,
  cardDashed,
  fieldClasses,
  labelClasses,
  checkboxClasses,
  btnPrimary,
  btnGhost,
  btnDanger,
  sectionTitle
} from '@/components/dara/theme';

async function authedUser() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  return daraUser;
}

async function addPersona(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const displayName = String(formData.get('displayName') ?? '').trim();
  const systemPrompt = String(formData.get('systemPrompt') ?? '').trim();
  if (!displayName || !systemPrompt) return;

  await withTenant(daraUser.companyId, async (tx) => {
    const count = await tx.persona.count({
      where: { companyId: daraUser.companyId }
    });
    await tx.persona.create({
      data: {
        companyId: daraUser.companyId,
        displayName,
        systemPrompt,
        isActive: formData.get('isActive') === 'on',
        sortOrder: count
      }
    });
  });
  revalidatePath('/app/personas');
}

async function updatePersona(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('personaId')));
  const displayName = String(formData.get('displayName') ?? '').trim();
  const systemPrompt = String(formData.get('systemPrompt') ?? '').trim();

  await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.persona.findFirst({
      where: { id, companyId: daraUser.companyId }
    });
    if (!owned) return;
    await tx.persona.update({
      where: { id },
      data: {
        displayName: displayName || owned.displayName,
        systemPrompt: systemPrompt || owned.systemPrompt,
        // Active state is owned by the dedicated toggle (toggleActive), not this
        // form — preserve it so saving name/prompt never flips active by accident.
        sortOrder: parseInt(String(formData.get('sortOrder') ?? '0'), 10) || 0
      }
    });
  });
  revalidatePath('/app/personas');
}

// Persist the active toggle immediately (its own action), so turning a persona
// off reliably excludes it from future evaluations without needing a separate Save.
async function toggleActive(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('personaId')));
  const next = await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.persona.findFirst({
      where: { id, companyId: daraUser.companyId }
    });
    if (!owned) return null;
    const isActive = !owned.isActive;
    await tx.persona.update({ where: { id }, data: { isActive } });
    return { isActive, displayName: owned.displayName };
  });
  if (next) {
    await recordAudit({
      action: 'persona.toggle',
      companyId: daraUser.companyId,
      actorId: daraUser.id,
      actorEmail: daraUser.email,
      entityType: 'persona',
      entityId: id,
      metadata: { isActive: next.isActive, name: next.displayName }
    });
  }
  revalidatePath('/app/personas');
}

async function deletePersona(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('personaId')));
  await withTenant(daraUser.companyId, async (tx) => {
    const owned = await tx.persona.findFirst({
      where: { id, companyId: daraUser.companyId }
    });
    if (!owned) return;
    await tx.persona.delete({ where: { id } });
  });
  revalidatePath('/app/personas');
}

async function restoreDefaults() {
  'use server';
  const daraUser = await authedUser();
  await withTenant(daraUser.companyId, (tx) =>
    seedBuiltinPersonas(tx, daraUser.companyId)
  );
  revalidatePath('/app/personas');
}

export default async function PersonasPage() {
  const daraUser = await authedUser();

  const personas = await withTenant(daraUser.companyId, async (tx) => {
    // Auto-seed the built-in personas for a company that has none yet.
    const count = await tx.persona.count({
      where: { companyId: daraUser.companyId }
    });
    if (count === 0) {
      await seedBuiltinPersonas(tx, daraUser.companyId);
    }
    return tx.persona.findMany({
      where: { companyId: daraUser.companyId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
    });
  });
  const activeCount = personas.filter((p) => p.isActive).length;

  return (
    <div className="mx-auto max-w-4xl fade">
      <PageHeader
        eyebrow="Analysis"
        title="Evaluator Personas"
        subtitle={`AI evaluator profiles — ${activeCount} of ${personas.length} active. Each active persona scores every criterion when an evaluation runs.`}
        action={
          <form action={restoreDefaults}>
            <button type="submit" className={btnGhost}>
              <RotateCcw className="h-4 w-4" />
              Restore defaults
            </button>
          </form>
        }
      />

      <div className={`${card} mb-6 px-4 py-3 text-[12px] text-t4`}>
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
          Template variables
        </span>{' '}
        {PERSONA_TEMPLATE_VARS.map((v) => (
          <code
            key={v}
            className="mx-0.5 rounded bg-bg px-1.5 py-0.5 font-mono text-[11px] text-[#6f9bf5]"
          >
            {v}
          </code>
        ))}
      </div>

      <div className="space-y-4">
        {personas.map((p) => (
          <div key={p.id.toString()} className={`${card} p-5`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-t5">
                {p.isActive
                  ? 'Active — scores every evaluation'
                  : 'Inactive — skipped in evaluations'}
              </span>
              <form action={toggleActive}>
                <input type="hidden" name="personaId" value={p.id.toString()} />
                <button
                  type="submit"
                  aria-pressed={p.isActive}
                  title={p.isActive ? 'Turn off (exclude from evaluations)' : 'Turn on'}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    p.isActive
                      ? 'border-[#10b981]/40 bg-[#10b981]/10 text-[#7de0a0]'
                      : 'border-line text-t5 hover:text-t3'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${p.isActive ? 'bg-[#10b981]' : 'bg-[#3d5270]'}`}
                  />
                  {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                </button>
              </form>
            </div>
            <form action={updatePersona} className="space-y-4">
              <input type="hidden" name="personaId" value={p.id.toString()} />
              <input type="hidden" name="sortOrder" value={p.sortOrder} />
              <div className="space-y-1.5">
                <label className={labelClasses}>Display name</label>
                <input
                  name="displayName"
                  type="text"
                  defaultValue={p.displayName}
                  className={fieldClasses}
                />
              </div>
              <div className="space-y-1.5">
                <label className={labelClasses}>System prompt template</label>
                <textarea
                  name="systemPrompt"
                  rows={4}
                  defaultValue={p.systemPrompt}
                  className={`${fieldClasses} font-mono text-[12px] leading-relaxed`}
                />
              </div>
              <div className="flex justify-end">
                <button type="submit" className={btnGhost}>
                  <Save className="h-4 w-4" />
                  Save
                </button>
              </div>
            </form>
            <form
              action={deletePersona}
              className="mt-2 flex justify-end border-t border-line pt-2"
            >
              <input type="hidden" name="personaId" value={p.id.toString()} />
              <button type="submit" className={btnDanger}>
                <Trash2 className="h-4 w-4" />
                Delete persona
              </button>
            </form>
          </div>
        ))}

        <div className={`${cardDashed} p-5`}>
          <h2 className={`mb-3 ${sectionTitle}`}>Add persona</h2>
          <form action={addPersona} className="space-y-4">
            <div className="flex items-end gap-4">
              <div className="flex-1 space-y-1.5">
                <label className={labelClasses}>
                  Display name <span className="text-[#3b6ef0]">*</span>
                </label>
                <input
                  name="displayName"
                  type="text"
                  required
                  placeholder="e.g. Cost / Price Analyst"
                  className={fieldClasses}
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-[13px] text-t4">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className={checkboxClasses}
                />
                Active
              </label>
            </div>
            <div className="space-y-1.5">
              <label className={labelClasses}>
                System prompt template <span className="text-[#3b6ef0]">*</span>
              </label>
              <textarea
                name="systemPrompt"
                rows={4}
                required
                placeholder="You are a ... Criterion: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}."
                className={`${fieldClasses} font-mono text-[12px] leading-relaxed`}
              />
            </div>
            <div className="flex justify-end">
              <button type="submit" className={btnPrimary}>
                <Plus className="h-4 w-4" />
                Add persona
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
