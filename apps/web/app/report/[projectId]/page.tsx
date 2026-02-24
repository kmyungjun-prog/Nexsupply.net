"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type Supplier = {
  name: string;
  location?: string;
  moq?: string;
  price_range?: { min?: number; max?: number; currency?: string };
  url: string;
  platform?: string;
};

type Forwarder = {
  name: string;
  source_url: string;
  origin_city?: string;
  services?: string;
};

type InlandOption = {
  name: string;
  type?: string;
  source_url: string;
};

type CustomsInfo = {
  hs_code_hint?: string;
  destination_port?: string;
  required_docs?: string[];
  source_urls?: string[];
};

type ResolvedView = {
  product_name?: string;
  product_name_zh?: string;
  category?: string;
  material?: string;
  estimated_specs?: string;
  search_keywords_1688?: string[];
  recommended_sourcing_region?: string;
  hs_code_hint?: string;
  shipping_method?: string;
  certifications_required?: string[];
  special_notes?: string;
  step1_sourcing?: Supplier[] | Array<{ factory_name?: string; name?: string; source_url?: string; url?: string; location?: string; moq?: string; price_range?: Supplier["price_range"]; platform?: string }>;
  step2_qc_packaging?: { name: string; source_url: string; services?: string; location?: string }[];
  step3_forwarding?: Forwarder[];
  step4_customs?: CustomsInfo;
  step5_inland?: InlandOption[];
  factory_candidates?: Supplier[] | Array<{ factory_name?: string; name?: string; source_url?: string; url?: string; location?: string; moq?: string; price_range?: Supplier["price_range"]; platform?: string }>;
  _source?: string;
  _analyzed_at?: string;
};

type ProjectReport = {
  id: string;
  status: string;
  resolvedViewJsonb: ResolvedView | null;
  resolvedViewUpdatedAt: string | null;
  createdAt: string;
};

// Normalize backend shape (factory_name/source_url) to Supplier (name/url)
function toSuppliers(raw: ResolvedView["step1_sourcing"] | ResolvedView["factory_candidates"]): Supplier[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.map((c: Record<string, unknown>) => ({
    name: String(c.factory_name ?? c.name ?? "Supplier"),
    location: c.location as string | undefined,
    moq: c.moq as string | undefined,
    price_range: c.price_range as Supplier["price_range"],
    url: String(c.source_url ?? c.url ?? ""),
    platform: c.platform as string | undefined,
  }));
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const COLOR = {
  primary: "#1d4ed8",
  primaryLight: "#eff6ff",
  border: "#e5e7eb",
  muted: "#6b7280",
  mutedLight: "#f9fafb",
  success: "#166534",
  successLight: "#dcfce7",
  warning: "#92400e",
  warningLight: "#fffbeb",
  danger: "#991b1b",
  dangerLight: "#fef2f2",
  text: "#111827",
};

const STEPS = [
  { num: 1, emoji: "💰", label: "Cost Estimate", desc: "How much will this cost you?", color: "#fef9c3", textColor: "#854d0e" },
  { num: 2, emoji: "🏭", label: "Where to Buy", desc: "Verified supplier options", color: "#dcfce7", textColor: "#166534" },
  { num: 3, emoji: "⚠️", label: "What to Watch", desc: "Certifications, risks & gotchas", color: "#fee2e2", textColor: "#991b1b" },
  { num: 4, emoji: "🚢", label: "How to Import", desc: "Shipping, customs & delivery", color: "#e0e7ff", textColor: "#3730a3" },
];

// ─── Shared UI ────────────────────────────────────────────────────────────────

const s = {
  card: {
    background: "#fff",
    border: `1px solid ${COLOR.border}`,
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 12,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  } as React.CSSProperties,
  label: {
    fontSize: 11,
    color: COLOR.muted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    fontWeight: 600,
    marginBottom: 4,
  },
  tag: (bg: string, color: string) => ({
    display: "inline-block" as const,
    padding: "3px 10px",
    borderRadius: 99,
    background: bg,
    color,
    fontSize: 12,
    fontWeight: 500,
    marginRight: 6,
    marginBottom: 4,
  }),
  externalLink: {
    color: COLOR.primary,
    textDecoration: "none" as const,
    fontSize: 13,
    fontWeight: 600,
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 4,
  },
};

function SectionHeader({ emoji, title, subtitle }: { emoji: string; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        {emoji} {title}
      </h2>
      <p style={{ color: COLOR.muted, margin: 0, fontSize: 14 }}>{subtitle}</p>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${COLOR.border}`, margin: "16px 0" }} />;
}

// ─── Step 1: Cost Estimate ────────────────────────────────────────────────────

function CostEstimate({ view }: { view: ResolvedView }) {
  const suppliers = toSuppliers(view.step1_sourcing ?? view.factory_candidates);
  const prices = suppliers.flatMap((s) => [s.price_range?.min, s.price_range?.max]).filter(Boolean) as number[];
  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const shipping = view.shipping_method;
  const moqs = suppliers.map((s) => s.moq).filter(Boolean);

  const costRows = [
    { label: "Unit cost (ex-factory)", value: minPrice != null && maxPrice != null ? `CNY ${minPrice}–${maxPrice}` : "See supplier listings", note: "Varies by MOQ and supplier" },
    { label: "Freight method", value: shipping ?? "LCL recommended for <5 CBM", note: "Based on quantity" },
    { label: "Estimated freight", value: "Contact forwarder for quote", note: "See Step 4 for forwarder list" },
    { label: "Import duty", value: "Check HS code in Step 3", note: view.hs_code_hint ?? "" },
    { label: "QC inspection", value: "~$300–500 per order", note: "Strongly recommended first order" },
  ];

  return (
    <div>
      <SectionHeader emoji="💰" title="Cost Estimate" subtitle="Rough breakdown of what you'll spend to land this product." />

      {(minPrice != null || maxPrice != null) && (
        <div style={{ ...s.card, background: "#fefce8", border: "1px solid #fef08a", marginBottom: 20 }}>
          <div style={s.label}>Estimated Unit Price Range</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#854d0e" }}>
            CNY {minPrice ?? "?"} – {maxPrice ?? "?"}
          </div>
          <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>
            Ex-factory price. Does not include freight, duties, or inspection.
          </div>
        </div>
      )}

      <div style={s.card}>
        <div style={s.label}>Cost Components</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <tbody>
            {costRows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < costRows.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
                <td style={{ padding: "10px 0", fontSize: 14, fontWeight: 500, color: COLOR.text, width: "35%" }}>{row.label}</td>
                <td style={{ padding: "10px 8px", fontSize: 14, fontWeight: 600 }}>{row.value}</td>
                <td style={{ padding: "10px 0", fontSize: 12, color: COLOR.muted, textAlign: "right" as const }}>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {moqs.length > 0 && (
        <div style={{ ...s.card, background: COLOR.mutedLight }}>
          <div style={s.label}>Minimum Order Quantities (MOQ)</div>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 8 }}>
            {moqs.slice(0, 3).map((moq, i) => (
              <span key={i} style={s.tag("#fff", COLOR.text)}>📦 {moq}</span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 8 }}>
            Tip: Negotiate lower MOQ for first sample order. Most factories accept 50–100 pcs for sampling.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Where to Buy ─────────────────────────────────────────────────────

function WhereToBuy({ view }: { view: ResolvedView }) {
  const suppliers = toSuppliers(view.step1_sourcing ?? view.factory_candidates);

  return (
    <div>
      <SectionHeader emoji="🏭" title="Where to Buy" subtitle="Matched suppliers from B2B platforms. Click to visit their storefront." />

      {view.recommended_sourcing_region && (
        <div style={{ ...s.card, background: "#f0fdf4", border: "1px solid #bbf7d0", marginBottom: 20 }}>
          <div style={s.label}>Best Sourcing Region for This Product</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>📍 {view.recommended_sourcing_region}</div>
          <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>
            Concentrated factories with competitive pricing and established export experience.
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center" as const, color: COLOR.muted }}>
          No supplier results yet. Try searching directly on{" "}
          <a href="https://www.alibaba.com" target="_blank" rel="noopener noreferrer" style={{ color: COLOR.primary }}>Alibaba.com</a>.
        </div>
      ) : (
        suppliers.map((supplier, i) => (
          <div key={i} style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{supplier.name}</div>
                <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                  {supplier.location && <span style={s.tag("#f3f4f6", COLOR.muted)}>📍 {supplier.location}</span>}
                  {supplier.moq && <span style={s.tag("#eff6ff", COLOR.primary)}>MOQ {supplier.moq}</span>}
                  {supplier.platform && <span style={s.tag("#fef9c3", "#854d0e")}>{supplier.platform}</span>}
                  {supplier.price_range?.min != null && (
                    <span style={s.tag("#f0fdf4", COLOR.success)}>
                      💰 {supplier.price_range.currency ?? "CNY"} {supplier.price_range.min}
                      {supplier.price_range.max != null && supplier.price_range.max !== supplier.price_range.min ? `–${supplier.price_range.max}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <a href={supplier.url} target="_blank" rel="noopener noreferrer"
                style={{ padding: "8px 16px", background: COLOR.primary, color: "#fff", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" as const }}>
                View Supplier →
              </a>
            </div>
          </div>
        ))
      )}

      {view.search_keywords_1688 && view.search_keywords_1688.length > 0 && (
        <>
          <Divider />
          <div style={{ ...s.card, background: COLOR.mutedLight }}>
            <div style={s.label}>Search directly on 1688.com (Chinese B2B)</div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 10 }}>
              {view.search_keywords_1688.map((kw, i) => (
                <a
                  key={i}
                  href={`https://s.1688.com/selloffer/offerlist.htm?keywords=${encodeURIComponent(kw)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: "6px 14px", background: "#fff", border: `1px solid ${COLOR.border}`, borderRadius: 8, fontSize: 14, color: COLOR.text, textDecoration: "none", fontWeight: 500 }}
                >
                  🔍 {kw}
                </a>
              ))}
            </div>
            <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 10 }}>
              Note: 1688.com is China domestic only. Use a buying agent or freight forwarder to facilitate orders.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 3: What to Watch ────────────────────────────────────────────────────

function WhatToWatch({ view }: { view: ResolvedView }) {
  const certs = view.certifications_required ?? [];

  const defaultRisks = [
    { title: "Sample before bulk order", desc: "Always order a sample (1–5 pcs) before committing to full MOQ. Check quality, dimensions, and packaging.", severity: "high" as const },
    { title: "Supplier verification", desc: "Use Alibaba Trade Assurance or request business license (营业执照). Avoid suppliers with no reviews.", severity: "high" as const },
    { title: "Payment terms", desc: "Standard: 30% deposit, 70% before shipment. Never pay 100% upfront to an unverified supplier.", severity: "high" as const },
    { title: "Lead time buffer", desc: "Add 2–3 weeks buffer to quoted lead times. Chinese New Year (Jan–Feb) can add 4–6 week delays.", severity: "medium" as const },
    { title: "Packaging & labeling", desc: "Confirm FNSKU, barcode, and retail packaging specs in writing before production starts.", severity: "medium" as const },
  ];

  const severityStyle = (sev: string) => sev === "high"
    ? { border: "1px solid #fecaca", background: "#fef2f2", dot: "#ef4444" }
    : { border: `1px solid ${COLOR.border}`, background: "#fff", dot: "#f59e0b" };

  return (
    <div>
      <SectionHeader emoji="⚠️" title="What to Watch Out For" subtitle="Key risks and requirements before you place an order." />

      {certs.length > 0 && (
        <div style={{ ...s.card, background: "#fef2f2", border: "1px solid #fecaca", marginBottom: 20 }}>
          <div style={s.label}>Required Certifications for Your Market</div>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 10 }}>
            {certs.map((cert, i) => (
              <span key={i} style={{ ...s.tag("#fff0f0", COLOR.danger), border: "1px solid #fca5a5", padding: "5px 14px", fontWeight: 700, fontSize: 13 }}>
                🏷 {cert}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 13, color: "#991b1b", marginTop: 10, fontWeight: 500 }}>
            Confirm supplier can provide these certifications before ordering. Request test reports.
          </div>
        </div>
      )}

      {view.special_notes && (
        <div style={{ ...s.card, background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 20 }}>
          <div style={s.label}>AI Note</div>
          <div style={{ fontSize: 14, color: COLOR.warning, marginTop: 4 }}>⚠️ {view.special_notes}</div>
        </div>
      )}

      <div>
        {defaultRisks.map((risk, i) => {
          const style = severityStyle(risk.severity);
          return (
            <div key={i} style={{ ...s.card, border: style.border, background: style.background }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: style.dot, marginTop: 6, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{risk.title}</div>
                  <div style={{ fontSize: 13, color: COLOR.muted, lineHeight: 1.5 }}>{risk.desc}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 4: How to Import ────────────────────────────────────────────────────

function HowToImport({ view }: { view: ResolvedView }) {
  const forwarders = view.step3_forwarding ?? [];
  const inland = view.step5_inland ?? [];
  const customs = view.step4_customs ?? {};
  const qcHubs = view.step2_qc_packaging ?? [
    { name: "QIMA", source_url: "https://www.qima.com", services: "Product inspection, factory audit, lab testing", location: view.recommended_sourcing_region ?? "China" },
    { name: "Bureau Veritas", source_url: "https://www.bureauveritas.com", services: "QC inspection & certification" },
    { name: "SGS", source_url: "https://www.sgs.com", services: "Testing, inspection, certification" },
  ];

  const importSteps = [
    {
      num: "A",
      title: "Pre-shipment QC",
      color: "#f0fdf4",
      border: "#bbf7d0",
      content: (
        <div>
          <p style={{ fontSize: 13, color: COLOR.muted, margin: "0 0 12px" }}>
            Book a 3rd-party inspection before goods leave the factory. Typically costs $250–400.
          </p>
          {qcHubs.slice(0, 3).map((hub, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < 2 ? `1px solid ${COLOR.border}` : "none" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{hub.name}</span>
                {hub.services && <span style={{ fontSize: 12, color: COLOR.muted, marginLeft: 8 }}>{hub.services}</span>}
              </div>
              <a href={hub.source_url} target="_blank" rel="noopener noreferrer" style={s.externalLink}>Visit →</a>
            </div>
          ))}
        </div>
      ),
    },
    {
      num: "B",
      title: "Freight Forwarding (China → Destination)",
      color: "#eff6ff",
      border: "#bfdbfe",
      content: (
        <div>
          <p style={{ fontSize: 13, color: COLOR.muted, margin: "0 0 12px" }}>
            Shipping method: <strong>{view.shipping_method ?? "LCL for small orders, FCL for 20+ CBM"}</strong>
          </p>
          {forwarders.length > 0 ? forwarders.slice(0, 3).map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < forwarders.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                {f.services && <span style={{ fontSize: 12, color: COLOR.muted, marginLeft: 8 }}>{f.services?.slice(0, 60)}</span>}
              </div>
              <a href={f.source_url} target="_blank" rel="noopener noreferrer" style={s.externalLink}>Visit →</a>
            </div>
          )) : (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              {[
                { name: "Flexport", url: "https://www.flexport.com", desc: "Full-service, great for beginners" },
                { name: "Freightos", url: "https://www.freightos.com", desc: "Instant online quotes" },
                { name: "Sinotrans", url: "https://www.sinotrans.com", desc: "China-based, cost-effective" },
              ].map((f, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < 2 ? `1px solid ${COLOR.border}` : "none" }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                    <span style={{ fontSize: 12, color: COLOR.muted, marginLeft: 8 }}>{f.desc}</span>
                  </div>
                  <a href={f.url} target="_blank" rel="noopener noreferrer" style={s.externalLink}>Visit →</a>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      num: "C",
      title: "Customs Clearance",
      color: "#faf5ff",
      border: "#e9d5ff",
      content: (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
            <div>
              <div style={s.label}>HS Code (estimated)</div>
              <div style={{ fontWeight: 700 }}>{customs.hs_code_hint ?? view.hs_code_hint ?? "Check with broker"}</div>
            </div>
            <div>
              <div style={s.label}>Entry Port</div>
              <div style={{ fontWeight: 700 }}>{customs.destination_port ?? "Nearest to destination"}</div>
            </div>
          </div>
          {customs.required_docs && (
            <div>
              <div style={s.label}>Required Documents</div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 8 }}>
                {customs.required_docs.map((doc, i) => (
                  <span key={i} style={s.tag("#f0fdf4", COLOR.success)}>✓ {doc}</span>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: COLOR.muted }}>
            Find a licensed customs broker:{" "}
            <a href="https://www.customscity.com" target="_blank" rel="noopener noreferrer" style={{ color: COLOR.primary }}>customscity.com</a>
          </div>
        </div>
      ),
    },
    {
      num: "D",
      title: "Inland Delivery (Destination)",
      color: "#fff7ed",
      border: "#fed7aa",
      content: (
        <div>
          <p style={{ fontSize: 13, color: COLOR.muted, margin: "0 0 12px" }}>
            From port to your warehouse or Amazon FBA.
          </p>
          {inland.length > 0 ? inland.map((opt, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < inland.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{opt.name}</span>
                {opt.type && <span style={s.tag("#f3f4f6", COLOR.muted)}>{opt.type.replace("_", " ")}</span>}
              </div>
              <a href={opt.source_url} target="_blank" rel="noopener noreferrer" style={s.externalLink}>Visit →</a>
            </div>
          )) : (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              {[
                { name: "UPS Supply Chain", url: "https://www.ups.com/us/en/supplychain", desc: "Port pickup & delivery" },
                { name: "Amazon FBA Direct", url: "https://sell.amazon.com/fulfillment-by-amazon", desc: "Direct to FBA warehouse" },
              ].map((opt, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < 1 ? `1px solid ${COLOR.border}` : "none" }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{opt.name}</span>
                  <a href={opt.url} target="_blank" rel="noopener noreferrer" style={s.externalLink}>Visit →</a>
                </div>
              ))}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <SectionHeader emoji="🚢" title="How to Import" subtitle="End-to-end import process: QC → Freight → Customs → Delivery." />
      {importSteps.map((step, i) => (
        <div key={i} style={{ ...s.card, borderLeft: `4px solid ${step.border}`, background: step.color }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: step.border, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
              {step.num}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{step.title}</div>
          </div>
          {step.content}
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ReportPage() {
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const { getIdToken } = useAuth();

  const [project, setProject] = useState<ProjectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  const loadProject = () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    getIdToken()
      .then((token) => get<ProjectReport>(`/projects/${projectId}`, token))
      .then(setProject)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (projectId) loadProject(); }, [projectId]);

  useEffect(() => {
    if (!projectId || !project) return;
    const view = project.resolvedViewJsonb;
    const hasData = view?.step1_sourcing?.length || view?.factory_candidates?.length || view?.product_name;
    const pending = project.status === "ANALYZING" || (!hasData && project.status === "BLUEPRINT_RUNNING");
    if (!pending) return;
    const t = setInterval(loadProject, 5000);
    return () => clearInterval(t);
  }, [projectId, project]);

  if (!projectId) return null;

  if (loading && !project) {
    return (
      <div style={{ maxWidth: 820, margin: "40px auto", padding: "0 20px" }}>
        {[40, 18, 120, 80].map((h, i) => (
          <div key={i} style={{ height: h, background: "#f3f4f6", borderRadius: 8, marginBottom: 12, width: i === 1 ? "60%" : "100%" }} />
        ))}
      </div>
    );
  }

  if (error && !project) {
    return (
      <div style={{ maxWidth: 820, margin: "40px auto", padding: "0 20px" }}>
        <div style={{ background: COLOR.dangerLight, border: "1px solid #fecaca", borderRadius: 8, padding: 16, color: COLOR.danger }}>{error}</div>
        <Link href="/" style={{ display: "inline-block", marginTop: 16, color: COLOR.primary }}>← Back</Link>
      </div>
    );
  }

  if (!project) return null;

  const view = project.resolvedViewJsonb ?? {};
  const isAnalyzing = project.status === "ANALYZING";

  return (
    <div style={{ maxWidth: 820, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, -apple-system, sans-serif", color: COLOR.text }}>

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const, marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>
            {view.product_name ?? "Sourcing Report"}
          </h1>
          {view.product_name_zh && (
            <span style={{ fontSize: 16, color: COLOR.muted, fontWeight: 400 }}>{view.product_name_zh}</span>
          )}
          <span style={{
            padding: "3px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700,
            background: isAnalyzing ? "#fef9c3" : COLOR.successLight,
            color: isAnalyzing ? "#854d0e" : COLOR.success,
          }}>
            {isAnalyzing ? "⏳ Analyzing…" : "✓ Ready"}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
          {view.category && <span style={s.tag("#f3f4f6", COLOR.muted)}>{view.category}</span>}
          {view.material && <span style={s.tag("#f3f4f6", COLOR.muted)}>{view.material}</span>}
          {view.recommended_sourcing_region && <span style={s.tag(COLOR.primaryLight, COLOR.primary)}>📍 {view.recommended_sourcing_region}</span>}
          {view.shipping_method && <span style={s.tag("#f0fdf4", COLOR.success)}>🚢 {view.shipping_method}</span>}
        </div>
      </div>

      {isAnalyzing ? (
        <div style={{ ...s.card, textAlign: "center" as const, padding: "48px 20px" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Finding suppliers & building your import plan…</div>
          <div style={{ color: COLOR.muted, fontSize: 14 }}>Auto-refreshing every 5 seconds.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 28 }}>
            {STEPS.map((step, i) => (
              <button
                key={i}
                onClick={() => setActiveStep(i)}
                style={{
                  padding: "14px 8px",
                  borderRadius: 12,
                  border: activeStep === i ? `2px solid ${COLOR.primary}` : `2px solid ${COLOR.border}`,
                  background: activeStep === i ? COLOR.primaryLight : "#fff",
                  cursor: "pointer",
                  textAlign: "center" as const,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 4 }}>{step.emoji}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: activeStep === i ? COLOR.primary : COLOR.text }}>{step.label}</div>
                <div style={{ fontSize: 11, color: COLOR.muted, marginTop: 2 }}>{step.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ minHeight: 400 }}>
            {activeStep === 0 && <CostEstimate view={view} />}
            {activeStep === 1 && <WhereToBuy view={view} />}
            {activeStep === 2 && <WhatToWatch view={view} />}
            {activeStep === 3 && <HowToImport view={view} />}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
            <button onClick={() => setActiveStep(Math.max(0, activeStep - 1))} disabled={activeStep === 0}
              style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${COLOR.border}`, background: "#fff", cursor: activeStep === 0 ? "not-allowed" : "pointer", color: activeStep === 0 ? "#d1d5db" : COLOR.text, fontWeight: 500 }}>
              ← Previous
            </button>
            <button onClick={() => setActiveStep(Math.min(3, activeStep + 1))} disabled={activeStep === 3}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: activeStep === 3 ? "#e5e7eb" : COLOR.primary, color: activeStep === 3 ? "#9ca3af" : "#fff", cursor: activeStep === 3 ? "not-allowed" : "pointer", fontWeight: 600 }}>
              Next →
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: 40, padding: 28, background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)", borderRadius: 16, color: "#fff" }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Too complex to handle alone?</div>
        <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 20 }}>
          NexSupply manages the full journey — supplier vetting, QC, freight, customs, and delivery to your door.
        </div>
        <a href="mailto:outreach@nexsupply.net"
          style={{ display: "inline-block", padding: "10px 24px", background: "#fff", color: COLOR.primary, borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: 14 }}>
          Get a free sourcing quote →
        </a>
      </div>

      <p style={{ marginTop: 24 }}>
        <Link href="/projects" style={{ color: COLOR.muted, fontSize: 14 }}>← Back to My Analyses</Link>
      </p>
    </div>
  );
}
