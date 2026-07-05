/* eslint-disable jsx-a11y/alt-text */
// Real (vector) PDF for the Solicitation Analysis Report, rendered server-side with
// @react-pdf/renderer — selectable text, controlled pagination (finding rows never clip or
// split mid-line), branded navy/gold layout, and a page-numbered footer. Built from the shared
// ReportModel so it always matches the on-screen report. Rendered to a Buffer in the /pdf route.

import {
  Document,
  Page,
  View,
  Text,
  StyleSheet
} from '@react-pdf/renderer';
import { SEVERITY, EFFORT, type SeverityValue, type EffortBandValue } from '@/components/dara/reportBits';
import type { ReportModel } from '@/utils/dara/report-data';

const NAVY = '#1B2A4A';
const GOLD = '#B8952A';
const INK = '#0F172A';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const SURF = '#F8FAFC';

const STATUS_COLOR: Record<string, { text: string; bg: string; label: string }> = {
  open: { text: '#991B1B', bg: '#FEE2E2', label: 'Open' },
  in_progress: { text: '#92400E', bg: '#FEF3C7', label: 'In Progress' },
  resolved: { text: '#166534', bg: '#DCFCE7', label: 'Resolved' }
};

const CHECK_COLOR: Record<string, { text: string; bg: string; glyph: string }> = {
  pass: { text: '#166534', bg: '#DCFCE7', glyph: '✓' },
  fail: { text: '#991B1B', bg: '#FEE2E2', glyph: '✕' },
  na: { text: MUTED, bg: '#EEF2F6', glyph: '–' }
};

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: INK,
    lineHeight: 1.4
  },
  // Header
  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  brandMark: { fontFamily: 'Helvetica-Bold', fontSize: 8, letterSpacing: 1.5, color: GOLD },
  brandDivider: { marginHorizontal: 5, color: FAINT, fontSize: 8 },
  brandName: { fontSize: 8, letterSpacing: 1.5, color: MUTED },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 17, color: INK, marginBottom: 3 },
  meta: { fontSize: 8.5, color: MUTED },
  generated: { fontSize: 8, color: FAINT, marginTop: 2 },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginTop: 10, marginBottom: 4 },

  // Section header band
  sectionBand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: NAVY,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 16,
    marginBottom: 8
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center' },
  sectionLetter: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: NAVY,
    backgroundColor: '#FFFFFF',
    width: 14,
    height: 14,
    textAlign: 'center',
    paddingTop: 2.5,
    marginRight: 6,
    borderRadius: 2
  },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9.5, color: '#FFFFFF', letterSpacing: 0.5 },
  sectionRight: { fontSize: 7.5, color: 'rgba(255,255,255,0.7)' },

  // Score cards
  cardRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  card: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  cardHi: { flex: 1, borderWidth: 1, borderColor: NAVY, backgroundColor: '#F4F6FB', borderRadius: 4, padding: 8 },
  cardEyebrow: { fontSize: 6.5, letterSpacing: 1, color: FAINT, textTransform: 'uppercase' },
  cardScore: { fontFamily: 'Helvetica-Bold', fontSize: 24, marginTop: 2 },
  cardSub: { fontSize: 7.5, color: MUTED, marginTop: 3 },

  recommendation: {
    borderLeftWidth: 2,
    borderLeftColor: NAVY,
    paddingLeft: 8,
    marginTop: 6,
    fontSize: 9,
    color: '#334155'
  },

  // Findings table
  tHead: {
    flexDirection: 'row',
    backgroundColor: SURF,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: LINE,
    paddingVertical: 4,
    paddingHorizontal: 4
  },
  th: { fontSize: 6.5, letterSpacing: 0.8, color: FAINT, textTransform: 'uppercase', fontFamily: 'Helvetica-Bold' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: LINE,
    paddingVertical: 5,
    paddingHorizontal: 4
  },
  cNum: { width: 20, fontSize: 8, color: FAINT },
  cSev: { width: 50 },
  cFind: { flex: 1, paddingRight: 6 },
  cOwner: { width: 78, paddingRight: 4 },
  cEffort: { width: 66, paddingRight: 4 },
  cStatus: { width: 52 },

  findText: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: INK },
  findAction: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  findRef: { fontSize: 6.5, letterSpacing: 0.5, color: FAINT, textTransform: 'uppercase', marginTop: 2 },
  ownerRole: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#334155' },
  ownerName: { fontSize: 7.5, color: MUTED, marginTop: 1 },
  effortLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#334155' },
  effortEst: { fontSize: 7, color: FAINT, marginTop: 1 },

  chip: { alignSelf: 'flex-start', borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1.5 },
  chipText: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', letterSpacing: 0.4, textTransform: 'uppercase' },

  // Readiness section
  twoCol: { flexDirection: 'row', gap: 10 },
  box: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  boxTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: INK, marginBottom: 5 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  kvLabel: { fontSize: 8, color: MUTED },
  kvValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#334155' },
  bigNum: { fontFamily: 'Helvetica-Bold', fontSize: 22, color: INK },

  distRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  distSwatch: { width: 8, height: 8, borderRadius: 1.5, marginRight: 5 },
  distLabel: { fontSize: 8, color: '#334155', flex: 1 },
  distCount: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: INK },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  checkGlyph: {
    width: 12,
    height: 12,
    borderRadius: 6,
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingTop: 2,
    marginRight: 5
  },
  checkLabel: { fontSize: 8, color: '#334155', flex: 1 },

  daraBox: { borderWidth: 1, borderColor: GOLD, backgroundColor: '#FBF8F0', borderRadius: 4, padding: 8, marginTop: 10 },
  daraTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: INK, marginBottom: 4 },
  daraSubmit: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#334155', marginTop: 4 },

  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderColor: LINE,
    paddingTop: 5,
    fontSize: 7,
    color: FAINT
  },
  empty: { fontSize: 9, color: MUTED, textAlign: 'center', marginTop: 24 }
});

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function bandColor(score: number | null): string {
  if (score == null) return MUTED;
  if (score >= 85) return '#166534';
  if (score >= 70) return '#B45309';
  return '#991B1B';
}

function Chip({ text, bg, label }: { text: string; bg: string; label: string }) {
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.chipText, { color: text }]}>{label}</Text>
    </View>
  );
}

const SEV_ORDER: SeverityValue[] = ['critical', 'high', 'medium', 'low'];

export default function ReportPdf({ model }: { model: ReportModel }) {
  const totalFindings = model.findings.length;

  return (
    <Document title={`Analysis Report — ${model.title}`} author="DARA · Crucible Insight">
      <Page size="LETTER" style={s.page}>
        {/* Header */}
        <View>
          <View style={s.brand}>
            <Text style={s.brandMark}>DARA</Text>
            <Text style={s.brandDivider}>·</Text>
            <Text style={s.brandName}>CRUCIBLE INSIGHT</Text>
          </View>
          <Text style={s.title}>{model.title}</Text>
          {model.metaLine ? <Text style={s.meta}>{model.metaLine}</Text> : null}
          <Text style={s.generated}>
            Solicitation Analysis Report{model.generatedAt ? ` · Generated ${fmtDate(model.generatedAt)}` : ''}
          </Text>
          <View style={s.rule} />
        </View>

        {!model.hasReport ? (
          <Text style={s.empty}>
            This solicitation doesn’t have a completed review yet. Run the review to generate the report.
          </Text>
        ) : (
          <>
            {/* A · Executive Summary */}
            <SectionBand letter="A" title="EXECUTIVE SUMMARY" />
            <View style={s.cardRow}>
              <View style={s.cardHi}>
                <Text style={s.cardEyebrow}>OVERALL SCORE</Text>
                <Text style={[s.cardScore, { color: bandColor(model.overall) }]}>{model.overall ?? '—'}</Text>
                <Text style={s.cardSub}>{model.scoreBand}</Text>
              </View>
              {model.isDirect ? (
                <>
                  <StatCard eyebrow="OPEN" value={model.openCount} sub="findings to address" />
                  <StatCard eyebrow="IN PROGRESS" value={model.inProgressCount} sub="being worked" />
                  <StatCard eyebrow="RESOLVED" value={model.resolvedCount} sub="closed out" />
                </>
              ) : (
                model.passCards.map((pc) => (
                  <View key={pc.label} style={s.card}>
                    <Text style={s.cardEyebrow}>{pc.label.toUpperCase()}</Text>
                    {pc.running ? (
                      <Text style={[s.cardScore, { fontSize: 13, color: NAVY }]}>In progress</Text>
                    ) : (
                      <Text style={[s.cardScore, { color: bandColor(pc.score) }]}>{pc.score ?? '—'}</Text>
                    )}
                    <Text style={s.cardSub}>{pc.findings} finding{pc.findings === 1 ? '' : 's'}</Text>
                  </View>
                ))
              )}
            </View>
            {model.recommendation ? <Text style={s.recommendation}>{model.recommendation}</Text> : null}

            {/* B · Prioritized Findings */}
            <SectionBand
              letter="B"
              title="PRIORITIZED FINDINGS & ACTION PLAN"
              right={`${totalFindings} finding${totalFindings === 1 ? '' : 's'} · ordered by severity`}
            />
            {totalFindings === 0 ? (
              <Text style={s.empty}>No findings — the review surfaced no issues.</Text>
            ) : (
              <View>
                <View style={s.tHead} fixed>
                  <Text style={[s.th, s.cNum]}>#</Text>
                  <Text style={[s.th, s.cSev]}>SEV</Text>
                  <Text style={[s.th, s.cFind]}>FINDING & ACTION</Text>
                  <Text style={[s.th, s.cOwner]}>OWNER</Text>
                  <Text style={[s.th, s.cEffort]}>EFFORT</Text>
                  <Text style={[s.th, s.cStatus]}>STATUS</Text>
                </View>
                {model.findings.map((f, i) => {
                  const sev = SEVERITY[f.severity as SeverityValue] ?? SEVERITY.medium;
                  const eff = f.effortBand ? EFFORT[f.effortBand as EffortBandValue] : null;
                  const st = STATUS_COLOR[f.status] ?? STATUS_COLOR.open;
                  return (
                    <View key={f.id} style={s.row} wrap={false}>
                      <Text style={s.cNum}>{String(i + 1).padStart(2, '0')}</Text>
                      <View style={s.cSev}>
                        <Chip text={sev.text} bg={sev.bg} label={sev.label} />
                      </View>
                      <View style={s.cFind}>
                        <Text style={s.findText}>{f.text}</Text>
                        {f.recommendedAction ? <Text style={s.findAction}>{f.recommendedAction}</Text> : null}
                        {f.requirementRef ? <Text style={s.findRef}>Ref: {f.requirementRef}</Text> : null}
                      </View>
                      <View style={s.cOwner}>
                        {f.ownerRole ? <Text style={s.ownerRole}>{f.ownerRole}</Text> : null}
                        {f.ownerName ? <Text style={s.ownerName}>{f.ownerName}</Text> : null}
                        {!f.ownerRole && !f.ownerName ? <Text style={s.ownerName}>—</Text> : null}
                      </View>
                      <View style={s.cEffort}>
                        <Text style={s.effortLabel}>{eff ? eff.label : '—'}</Text>
                        {f.effortEstimate ? <Text style={s.effortEst}>{f.effortEstimate}</Text> : null}
                      </View>
                      <View style={s.cStatus}>
                        <Chip text={st.text} bg={st.bg} label={st.label} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* C · Submission Readiness */}
            <SectionBand letter="C" title="SUBMISSION READINESS" />
            <View style={s.twoCol}>
              <View style={s.box} wrap={false}>
                <Text style={s.boxTitle}>Submission Deadline</Text>
                {model.daysToDeadline != null ? (
                  <>
                    <Text style={s.bigNum}>{Math.max(0, model.daysToDeadline)} days</Text>
                    <Text style={[s.kvLabel, { marginBottom: 6 }]}>{fmtDate(model.dueDate)}</Text>
                  </>
                ) : (
                  <Text style={[s.kvLabel, { marginBottom: 6 }]}>No due date set</Text>
                )}
                <View style={s.kv}>
                  <Text style={s.kvLabel}>Open findings</Text>
                  <Text style={[s.kvValue, model.openCount > 0 ? { color: '#991B1B' } : {}]}>{model.openCount}</Text>
                </View>
                <View style={s.kv}>
                  <Text style={s.kvLabel}>Resolved findings</Text>
                  <Text style={s.kvValue}>{model.resolvedCount}</Text>
                </View>
                <View style={s.kv}>
                  <Text style={s.kvLabel}>Est. effort remaining</Text>
                  <Text style={s.kvValue}>{model.estRemaining}</Text>
                </View>
              </View>

              <View style={s.box} wrap={false}>
                <Text style={s.boxTitle}>Finding Distribution</Text>
                {SEV_ORDER.map((k) => (
                  <View key={k} style={s.distRow}>
                    <View style={[s.distSwatch, { backgroundColor: SEVERITY[k].bar }]} />
                    <Text style={s.distLabel}>{SEVERITY[k].label}</Text>
                    <Text style={s.distCount}>{model.counts[k]}</Text>
                  </View>
                ))}
              </View>
            </View>

            {(model.recommendation || model.recommendedSubmitAt) && (
              <View style={s.daraBox} wrap={false}>
                <Text style={s.daraTitle}>DARA Recommendation</Text>
                {model.recommendation ? <Text style={{ fontSize: 8, color: '#334155' }}>{model.recommendation}</Text> : null}
                {model.recommendedSubmitAt ? (
                  <Text style={s.daraSubmit}>Recommended submission: {fmtDate(model.recommendedSubmitAt)}</Text>
                ) : null}
              </View>
            )}

            {model.checklist.length > 0 && (
              <View style={{ marginTop: 10 }} wrap={false}>
                <Text style={s.boxTitle}>Pre-Submission Checklist</Text>
                {model.checklist.map((it, i) => {
                  const c = CHECK_COLOR[it.state] ?? CHECK_COLOR.na;
                  return (
                    <View key={i} style={s.checkRow}>
                      <Text style={[s.checkGlyph, { color: c.text, backgroundColor: c.bg }]}>{c.glyph}</Text>
                      <Text style={s.checkLabel}>
                        {it.label}
                        {it.detail ? <Text style={{ color: FAINT }}> — {it.detail}</Text> : null}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* Footer with page numbers */}
        <View style={s.footer} fixed>
          <Text>{model.solNumber ? `${model.solNumber} · ` : ''}DARA · Crucible Insight</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function SectionBand({ letter, title, right }: { letter: string; title: string; right?: string }) {
  return (
    <View style={s.sectionBand}>
      <View style={s.sectionLeft}>
        <Text style={s.sectionLetter}>{letter}</Text>
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {right ? <Text style={s.sectionRight}>{right}</Text> : null}
    </View>
  );
}

function StatCard({ eyebrow, value, sub }: { eyebrow: string; value: number; sub: string }) {
  return (
    <View style={s.card}>
      <Text style={s.cardEyebrow}>{eyebrow}</Text>
      <Text style={[s.cardScore, { color: INK }]}>{value}</Text>
      <Text style={s.cardSub}>{sub}</Text>
    </View>
  );
}
