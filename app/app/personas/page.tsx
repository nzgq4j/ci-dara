import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { prisma } from '@/utils/prisma';
import {
  seedBuiltinPersonas,
  PERSONA_TEMPLATE_VARS
} from '@/utils/dara/personas';
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

  const count = await prisma.persona.count({
    where: { companyId: daraUser.companyId }
  });
  await prisma.persona.create({
    data: {
      companyId: daraUser.companyId,
      displayName,
      systemPrompt,
      isActive: formData.get('isActive') === 'on',
      sortOrder: count
    }
  });
  revalidatePath('/app/personas');
}

async function updatePersona(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('personaId')));
  const owned = await prisma.persona.findFirst({
    where: { id, companyId: daraUser.companyId }
  });
  if (!owned) return;

  const displayName = String(formData.get('displayName') ?? '').trim();
  const systemPrompt = String(formData.get('systemPrompt') ?? '').trim();
  await prisma.persona.update({
    where: { id },
    data: {
      displayName: displayName || owned.displayName,
      systemPrompt: systemPrompt || owned.systemPrompt,
      isActive: formData.get('isActive') === 'on',
      sortOrder: parseInt(String(formData.get('sortOrder') ?? '0'), 10) || 0
    }
  });
  revalidatePath('/app/personas');
}

async function deletePersona(formData: FormData) {
  'use server';
  const daraUser = await authedUser();
  const id = BigInt(String(formData.get('personaId')));
  const owned = await prisma.persona.findFirst({
    where: { id, companyId: daraUser.companyId }
  });
  if (!owned) return;
  await prisma.persona.delete({ where: { id } });
  revalidatePath('/app/personas');
}

async function restoreDefaults() {
  'use server';
  const daraUser = await authedUser();
  await seedBuiltinPersonas(daraUser.companyId);
  revalidatePath('/app/personas');
}

export default async function PersonasPage() {
  const daraUser = await authedUser();

  // Auto-seed the built-in personas for a company that has none yet.
  const count = await prisma.persona.count({
    where: { companyId: daraUser.companyId }
  });
  if (count === 0) {
    await seedBuiltinPersonas(daraUser.companyId);
  }

  const personas = await prisma.persona.findMany({
    where: { companyId: daraUser.companyId },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]
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

      <div className={`${card} mb-6 px-4 py-3 text-[12px] text-[#7d97b3]`}>
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#3d5270]">
          Template variables
        </span>{' '}
        {PERSONA_TEMPLATE_VARS.map((v) => (
          <code
            key={v}
            className="mx-0.5 rounded bg-[#070c16] px-1.5 py-0.5 font-mono text-[11px] text-[#6f9bf5]"
          >
            {v}
          </code>
        ))}
      </div>

      <div className="space-y-4">
        {personas.map((p) => (
          <div key={p.id.toString()} className={`${card} p-5`}>
            <form action={updatePersona} className="space-y-4">
              <input type="hidden" name="personaId" value={p.id.toString()} />
              <input type="hidden" name="sortOrder" value={p.sortOrder} />
              <div className="flex items-end gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className={labelClasses}>Display name</label>
                  <input
                    name="displayName"
                    type="text"
                    defaultValue={p.displayName}
                    className={fieldClasses}
                  />
                </div>
                <label className="flex h-9 items-center gap-2 text-[13px] text-[#7d97b3]">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={p.isActive}
                    className={checkboxClasses}
                  />
                  Active
                </label>
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
              className="mt-2 flex justify-end border-t border-[#1a2f4a] pt-2"
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
              <label className="flex h-9 items-center gap-2 text-[13px] text-[#7d97b3]">
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
