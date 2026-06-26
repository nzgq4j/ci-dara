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

const fieldClasses =
  'w-full rounded-md border border-[#1a2f4a] bg-[#070c16] px-3 py-2 text-sm text-white placeholder:text-[#7d97b3] focus:border-[#378ADD] focus:outline-none focus:ring-1 focus:ring-[#378ADD]';
const labelClasses = 'text-xs font-medium uppercase tracking-wide text-[#7d97b3]';
const primaryBtn =
  'inline-flex items-center gap-2 rounded-md bg-[#378ADD] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f78c2]';
const ghostBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#1a2f4a] px-3 py-2 text-sm text-[#7d97b3] transition-colors hover:text-white';
const dangerBtn =
  'inline-flex items-center gap-2 rounded-md border border-[#5a1f1f] px-3 py-2 text-sm text-[#e07d7d] transition-colors hover:bg-[#5a1f1f]/30';

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

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Evaluator Personas</h1>
          <p className="text-sm text-[#7d97b3]">
            AI evaluator profiles. Each active persona scores every criterion
            when an evaluation runs.
          </p>
        </div>
        <form action={restoreDefaults}>
          <button type="submit" className={ghostBtn}>
            <RotateCcw className="h-4 w-4" />
            Restore defaults
          </button>
        </form>
      </div>

      <div className="rounded-md border border-[#1a2f4a] bg-[#0d1527] px-4 py-3 text-xs text-[#7d97b3]">
        Available template variables:{' '}
        {PERSONA_TEMPLATE_VARS.map((v) => (
          <code
            key={v}
            className="mx-0.5 rounded bg-[#070c16] px-1.5 py-0.5 text-[#7db8e0]"
          >
            {v}
          </code>
        ))}
      </div>

      {personas.map((p) => (
        <div
          key={p.id.toString()}
          className="rounded-lg border border-[#1a2f4a] bg-[#0d1527] p-5"
        >
          <form action={updatePersona} className="space-y-4">
            <input type="hidden" name="personaId" value={p.id.toString()} />
            <input type="hidden" name="sortOrder" value={p.sortOrder} />
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1.5">
                <label className={labelClasses}>Display name</label>
                <input
                  name="displayName"
                  type="text"
                  defaultValue={p.displayName}
                  className={fieldClasses}
                />
              </div>
              <label className="mt-5 flex items-center gap-2 text-sm text-[#7d97b3]">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={p.isActive}
                  className="h-4 w-4 rounded border-[#1a2f4a] bg-[#070c16]"
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
                className={fieldClasses}
              />
            </div>
            <div className="flex justify-end">
              <button type="submit" className={ghostBtn}>
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
            <button type="submit" className={dangerBtn}>
              <Trash2 className="h-4 w-4" />
              Delete persona
            </button>
          </form>
        </div>
      ))}

      <div className="rounded-lg border border-dashed border-[#1a2f4a] bg-[#0d1527] p-5">
        <h2 className="mb-3 text-sm font-medium text-white">Add persona</h2>
        <form action={addPersona} className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-1.5">
              <label className={labelClasses}>
                Display name <span className="text-[#378ADD]">*</span>
              </label>
              <input
                name="displayName"
                type="text"
                required
                placeholder="e.g. Cost / Price Analyst"
                className={fieldClasses}
              />
            </div>
            <label className="mt-5 flex items-center gap-2 text-sm text-[#7d97b3]">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked
                className="h-4 w-4 rounded border-[#1a2f4a] bg-[#070c16]"
              />
              Active
            </label>
          </div>
          <div className="space-y-1.5">
            <label className={labelClasses}>
              System prompt template <span className="text-[#378ADD]">*</span>
            </label>
            <textarea
              name="systemPrompt"
              rows={4}
              required
              placeholder="You are a ... Criterion: {{CRITERION_NAME}} — {{CRITERION_DESCRIPTION}}. Solicitation: {{SOLICITATION_TITLE}} ({{REFERENCE_NUMBER}}). FAR: {{FAR_REFERENCE}}."
              className={fieldClasses}
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" className={primaryBtn}>
              <Plus className="h-4 w-4" />
              Add persona
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
