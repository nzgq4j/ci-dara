import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Save, Building2, MapPin, ShieldCheck } from 'lucide-react';
import { createClient } from '@/utils/supabase/server';
import { getDaraUser } from '@/utils/dara/provision';
import { withTenant } from '@/utils/prisma';
import { recordAudit } from '@/utils/dara/audit';
import PageHeader from '@/components/dara/PageHeader';
import {
  card,
  fieldClasses,
  labelClasses,
  btnPrimary,
  sectionTitle
} from '@/components/dara/theme';

const CMMC_LEVELS = ['', 'Level 1', 'Level 2', 'Level 3'];
const CMMC_STATUSES = [
  '',
  'Not started',
  'Self-assessment',
  'Preparing for assessment',
  'Assessment scheduled',
  'Certified',
  'Expired'
];

async function requireCompanyAdmin() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/signin');
  const daraUser = await getDaraUser(user.id);
  if (!daraUser) redirect('/signin');
  if (daraUser.role !== 'company_admin') redirect('/app/dashboard');
  return daraUser;
}

function slugify(name: string, companyId: bigint) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'org';
  return `${base}-${companyId.toString(36)}`;
}

async function updateCompany(formData: FormData) {
  'use server';
  const daraUser = await requireCompanyAdmin();

  const str = (k: string, max: number) => {
    const v = String(formData.get(k) ?? '').trim();
    return v ? v.slice(0, max) : null;
  };
  const dateVal = (k: string) => {
    const v = String(formData.get(k) ?? '').trim();
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  const name = str('name', 255);
  if (!name) redirect('/app/company?error=name'); // name is required

  const cmmcTargetLevel = str('cmmcTargetLevel', 20);
  const cmmcStatus = str('cmmcStatus', 40);

  await withTenant(daraUser.companyId, (tx) =>
    tx.company.update({
      where: { id: daraUser.companyId },
      data: {
        name,
        slug: slugify(name, daraUser.companyId),
        legalName: str('legalName', 255),
        website: str('website', 255),
        phone: str('phone', 50),
        cageCode: str('cageCode', 20),
        ueiCode: str('ueiCode', 20),
        addressLine1: str('addressLine1', 255),
        addressLine2: str('addressLine2', 255),
        city: str('city', 120),
        state: str('state', 120),
        postalCode: str('postalCode', 20),
        country: str('country', 120),
        cmmcTargetLevel: CMMC_LEVELS.includes(cmmcTargetLevel ?? '')
          ? cmmcTargetLevel
          : null,
        cmmcStatus: CMMC_STATUSES.includes(cmmcStatus ?? '') ? cmmcStatus : null,
        c3paoName: str('c3paoName', 255),
        c3paoContact: str('c3paoContact', 255),
        c3paoEmail: str('c3paoEmail', 255),
        c3paoPhone: str('c3paoPhone', 50),
        assessmentDate: dateVal('assessmentDate'),
        certExpiresAt: dateVal('certExpiresAt')
      }
    })
  );

  await recordAudit({
    action: 'company.update',
    companyId: daraUser.companyId,
    actorId: daraUser.id,
    actorEmail: daraUser.email,
    entityType: 'company',
    entityId: daraUser.companyId,
    metadata: { name }
  });
  revalidatePath('/app/company');
  redirect('/app/company?saved=1');
}

function dateInput(d: Date | null) {
  return d ? d.toISOString().slice(0, 10) : '';
}

export default async function CompanySettingsPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const daraUser = await requireCompanyAdmin();
  const company = await withTenant(daraUser.companyId, (tx) =>
    tx.company.findUnique({ where: { id: daraUser.companyId } })
  );
  if (!company) redirect('/app/dashboard');

  return (
    <div className="mx-auto max-w-3xl fade">
      <PageHeader
        eyebrow="Organization"
        title="Company"
        subtitle="Company profile, address, and CMMC assessment details."
      />

      {searchParams.saved && (
        <div className="mb-4 rounded-lg border border-[#166534]/30 bg-[#DCFCE7] px-4 py-2.5 text-[13px] text-[#166534]">
          Company information saved.
        </div>
      )}
      {searchParams.error === 'name' && (
        <div className="mb-4 rounded-lg border border-[#991B1B]/25 bg-[#FEE2E2] px-4 py-2.5 text-[13px] text-[#991B1B]">
          Company name is required.
        </div>
      )}

      <form action={updateCompany} className="space-y-6">
        {/* Profile */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
            <Building2 className="h-4 w-4 text-t5" />
            Profile
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Company name *"
              name="name"
              defaultValue={company.name}
              required
            />
            <Field
              label="Legal entity name"
              name="legalName"
              defaultValue={company.legalName}
            />
            <Field
              label="Website"
              name="website"
              type="url"
              placeholder="https://"
              defaultValue={company.website}
            />
            <Field
              label="Phone"
              name="phone"
              type="tel"
              defaultValue={company.phone}
            />
            <Field
              label="CAGE code"
              name="cageCode"
              defaultValue={company.cageCode}
            />
            <Field
              label="UEI (SAM.gov)"
              name="ueiCode"
              defaultValue={company.ueiCode}
            />
          </div>
        </section>

        {/* Address */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-4 flex items-center gap-2 ${sectionTitle}`}>
            <MapPin className="h-4 w-4 text-t5" />
            Address
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Address line 1"
                name="addressLine1"
                defaultValue={company.addressLine1}
              />
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Address line 2"
                name="addressLine2"
                defaultValue={company.addressLine2}
              />
            </div>
            <Field label="City" name="city" defaultValue={company.city} />
            <Field
              label="State / Province"
              name="state"
              defaultValue={company.state}
            />
            <Field
              label="Postal code"
              name="postalCode"
              defaultValue={company.postalCode}
            />
            <Field
              label="Country"
              name="country"
              defaultValue={company.country}
            />
          </div>
        </section>

        {/* CMMC / C3PAO */}
        <section className={`${card} p-6`}>
          <h2 className={`mb-1 flex items-center gap-2 ${sectionTitle}`}>
            <ShieldCheck className="h-4 w-4 text-t5" />
            CMMC assessment &amp; auditor (C3PAO)
          </h2>
          <p className="mb-4 text-[12px] text-t4">
            Track your target CMMC level and the Certified Third-Party Assessment
            Organization (C3PAO) handling your assessment.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Target CMMC level"
              name="cmmcTargetLevel"
              options={CMMC_LEVELS}
              defaultValue={company.cmmcTargetLevel ?? ''}
            />
            <Select
              label="Assessment status"
              name="cmmcStatus"
              options={CMMC_STATUSES}
              defaultValue={company.cmmcStatus ?? ''}
            />
            <Field
              label="C3PAO / assessor name"
              name="c3paoName"
              defaultValue={company.c3paoName}
            />
            <Field
              label="Assessor contact name"
              name="c3paoContact"
              defaultValue={company.c3paoContact}
            />
            <Field
              label="Assessor email"
              name="c3paoEmail"
              type="email"
              defaultValue={company.c3paoEmail}
            />
            <Field
              label="Assessor phone"
              name="c3paoPhone"
              type="tel"
              defaultValue={company.c3paoPhone}
            />
            <Field
              label="Last assessment date"
              name="assessmentDate"
              type="date"
              defaultValue={dateInput(company.assessmentDate)}
            />
            <Field
              label="Certification expires"
              name="certExpiresAt"
              type="date"
              defaultValue={dateInput(company.certExpiresAt)}
            />
          </div>
        </section>

        <div className="flex justify-end">
          <button type="submit" className={btnPrimary}>
            <Save className="h-4 w-4" />
            Save company information
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = 'text',
  placeholder,
  required
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelClasses}>{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ''}
        className={fieldClasses}
      />
    </div>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelClasses}>{label}</label>
      <select name={name} defaultValue={defaultValue} className={fieldClasses}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o || '—'}
          </option>
        ))}
      </select>
    </div>
  );
}
