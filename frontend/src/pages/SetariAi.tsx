import { useMemo, useState } from "react"
import { Bot, BrainCircuit, CheckCircle2, Eye, ShieldCheck, Wand2 } from "lucide-react"
import PageHeader from "../components/PageHeader"
import {
  DocumentMetric,
  DocumentSection,
  InlineNotice,
  documentButtonPrimaryClass,
  documentButtonSecondaryClass,
} from "../components/DocumentUi"
import {
  defaultGufoAiConfig,
  readGufoAiConfig,
  saveGufoAiConfig,
  type GufoAiConfig,
  type GufoAiMode,
} from "../lib/gufoAiConfig"

const modeCards: Array<{
  id: GufoAiMode
  title: string
  description: string
  icon: typeof Eye
}> = [
  {
    id: "observer",
    title: "Observer",
    description: "Vede pagina curenta, intelege contextul si avertizeaza cand ceva pare in neregula.",
    icon: Eye,
  },
  {
    id: "copilot",
    title: "Copilot",
    description: "Ofera explicatii, sugestii si pregateste drafturi sau pasi urmatori cu confirmare.",
    icon: BrainCircuit,
  },
  {
    id: "action",
    title: "Action",
    description: "Pregateste executii asistate, dar ramane blocat pe confirmare pentru actiuni sensibile.",
    icon: Wand2,
  },
]

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={[
        "flex items-start gap-3 rounded-[16px] border px-4 py-3 transition",
        checked ? "border-[#DCE7F5] bg-[#F7FAFE]" : "border-slate-200 bg-white",
        disabled ? "opacity-60" : "cursor-pointer hover:border-slate-300",
      ].join(" ")}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#17324D] focus:ring-[#DCE7F5]"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div>
        <div className="text-sm font-semibold text-[#17324D]">{label}</div>
        <div className="mt-1 text-sm leading-6 text-slate-500">{description}</div>
      </div>
    </label>
  )
}

export default function SetariAiPage() {
  const [config, setConfig] = useState<GufoAiConfig>(() => readGufoAiConfig())
  const [message, setMessage] = useState("")

  const enabledCapabilities = useMemo(
    () =>
      [
        config.watchCurrentPage,
        config.proactiveWarnings,
        config.conversationalHelp,
        config.suggestFixes,
        config.prepareDrafts,
        config.allowNomenclatureDrafts,
        config.allowInventoryDrafts,
        config.allowFinancialDrafts,
        config.allowSettingsGuidance,
      ].filter(Boolean).length,
    [config]
  )

  function patchConfig(patch: Partial<GufoAiConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }))
    setMessage("")
  }

  function patchRole(role: keyof GufoAiConfig["roleAccess"], value: boolean) {
    setConfig((prev) => ({
      ...prev,
      roleAccess: {
        ...prev.roleAccess,
        [role]: value,
      },
    }))
    setMessage("")
  }

  function handleSave() {
    saveGufoAiConfig(config)
    setMessage("Setarile Gufo AI au fost salvate. Widgetul se actualizeaza imediat in ERP.")
  }

  function handleReset() {
    setConfig({ ...defaultGufoAiConfig, roleAccess: { ...defaultGufoAiConfig.roleAccess } })
    setMessage("")
  }

  return (
    <div className="space-y-3">
      <PageHeader
        badge="asistent inteligent"
        title="Setari Gufo AI"
        subtitle="Configurezi cum vede Gufo AI aplicatia, ce are voie sa sugereze si ce roluri pot folosi asistenta conversationala, fara sa atingi fluxurile critice din ERP."
      />

      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-4">
        <DocumentMetric title="Status" value={config.enabled ? "Activ" : "Pauza"} tone={config.enabled ? "emerald" : "slate"} />
        <DocumentMetric title="Mod curent" value={config.mode === "observer" ? "Observer" : config.mode === "copilot" ? "Copilot" : "Action"} tone="blue" />
        <DocumentMetric title="Capabilitati active" value={enabledCapabilities} tone="amber" />
        <DocumentMetric title="Roluri cu acces" value={Object.values(config.roleAccess).filter(Boolean).length} tone="slate" />
      </div>

      <InlineNotice>
        În aceasta etapa, Gufo AI ramane un asistent ghidat: observa pagina curenta, explica modulele si poate pregati sugestii sau drafturi. Nu executa singur actiuni financiare sau fiscale.
      </InlineNotice>
      {message ? <InlineNotice tone="success">{message}</InlineNotice> : null}

      <DocumentSection
        title="Activare si comportament"
        description="Definesti cum lucreaza asistentul si cat de proactiv este in ERP."
        actions={
          <>
            <button type="button" className={documentButtonSecondaryClass} onClick={handleReset}>Reset implicit</button>
            <button type="button" className={documentButtonPrimaryClass} onClick={handleSave}>Salveaza</button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ToggleRow
            label="Activeaza Gufo AI"
            description="Afiseaza butonul asistentului in ERP si permite utilizatorilor autorizati sa deschida chatul contextual."
            checked={config.enabled}
            onChange={(value) => patchConfig({ enabled: value })}
          />
          <ToggleRow
            label="Monitorizare pagina curenta"
            description="AI-ul foloseste ruta curenta, modulul deschis si contextul vizual pentru raspunsuri mai bune."
            checked={config.watchCurrentPage}
            onChange={(value) => patchConfig({ watchCurrentPage: value })}
            disabled={!config.enabled}
          />
          <ToggleRow
            label="Avertizari proactive"
            description="Poate semnala utilizatorului ca lipsesc date, filtre sau configurari care par gresite."
            checked={config.proactiveWarnings}
            onChange={(value) => patchConfig({ proactiveWarnings: value })}
            disabled={!config.enabled}
          />
          <ToggleRow
            label="Conversatie naturala"
            description="Permite intrebari si raspunsuri de tip coleg virtual, direct in pagina in care lucreaza utilizatorul."
            checked={config.conversationalHelp}
            onChange={(value) => patchConfig({ conversationalHelp: value })}
            disabled={!config.enabled}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {modeCards.map((card) => {
            const Icon = card.icon
            const active = config.mode === card.id
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => patchConfig({ mode: card.id })}
                className={[
                  "rounded-[18px] border p-4 text-left transition",
                  active
                    ? "border-[#17324D] bg-[#17324D] text-white shadow-sm shadow-[#17324D]/20"
                    : "border-slate-200 bg-white hover:border-slate-300",
                ].join(" ")}
              >
                <div className={["inline-flex h-11 w-11 items-center justify-center rounded-[14px]", active ? "bg-white/12 text-white" : "bg-slate-100 text-[#17324D]"].join(" ")}>
                  <Icon size={20} />
                </div>
                <div className="mt-3 text-[17px] font-semibold">{card.title}</div>
                <div className={["mt-2 text-sm leading-6", active ? "text-slate-100" : "text-slate-500"].join(" ")}>{card.description}</div>
              </button>
            )
          })}
        </div>
      </DocumentSection>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DocumentSection title="Ce are voie sa sugereze" description="Alegi zonele in care Gufo AI poate pregati ajutor util pentru utilizatori.">
          <div className="space-y-3">
            <ToggleRow
              label="Sugestii si corectii"
              description="Poate recomanda pasi, corecturi de completare si verificari in modulele active."
              checked={config.suggestFixes}
              onChange={(value) => patchConfig({ suggestFixes: value })}
              disabled={!config.enabled}
            />
            <ToggleRow
              label="Pregatire drafturi"
              description="Poate propune drafturi de lucru si completari preliminare, fara executie automata."
              checked={config.prepareDrafts}
              onChange={(value) => patchConfig({ prepareDrafts: value })}
              disabled={!config.enabled}
            />
            <ToggleRow
              label="Ghidare setari ERP"
              description="Explica setarile firmei, TVA, numerotare, marketplace si alte configurari administrative."
              checked={config.allowSettingsGuidance}
              onChange={(value) => patchConfig({ allowSettingsGuidance: value })}
              disabled={!config.enabled}
            />
            <ToggleRow
              label="Confirmare obligatorie"
              description="Pastreaza modelul sigur: AI-ul pregateste, dar utilizatorul confirma orice actiune relevanta."
              checked={config.requireConfirmation}
              onChange={(value) => patchConfig({ requireConfirmation: value })}
              disabled={!config.enabled}
            />
          </div>
        </DocumentSection>

        <DocumentSection title="Zone de lucru permise" description="Activezi zonele in care AI-ul poate ajuta mai departe cu drafturi sau recomandari.">
          <div className="space-y-3">
            <ToggleRow
              label="Nomenclator si catalog"
              description="Produse, categorii, subcategorii, departamente si alte structuri de baza."
              checked={config.allowNomenclatureDrafts}
              onChange={(value) => patchConfig({ allowNomenclatureDrafts: value })}
              disabled={!config.enabled}
            />
            <ToggleRow
              label="Stoc si operatiuni"
              description="Poate ghida sau pregati drafturi pentru miscari de stoc, transferuri si productie."
              checked={config.allowInventoryDrafts}
              onChange={(value) => patchConfig({ allowInventoryDrafts: value })}
              disabled={!config.enabled}
            />
            <ToggleRow
              label="Financiar si bonuri"
              description="Ramane o zona sensibila. Pastreaz-o inchisa pana cand vrem fluxuri aprobate cap-coada."
              checked={config.allowFinancialDrafts}
              onChange={(value) => patchConfig({ allowFinancialDrafts: value })}
              disabled={!config.enabled}
            />
          </div>
        </DocumentSection>
      </div>

      <DocumentSection title="Acces pe rol" description="Definesti cine poate lucra cu Gufo AI in compania curenta.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            ["owner", "Proprietar"],
            ["admin", "Administrator"],
            ["manager", "Manager"],
            ["operator", "Operator"],
            ["cashier", "Casier"],
          ].map(([role, label]) => (
            <label key={role} className="flex items-center gap-3 rounded-[16px] border border-slate-200 bg-white px-4 py-3">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-[#17324D] focus:ring-[#DCE7F5]"
                checked={config.roleAccess[role as keyof GufoAiConfig["roleAccess"]]}
                onChange={(event) => patchRole(role as keyof GufoAiConfig["roleAccess"], event.target.checked)}
              />
              <div>
                <div className="text-sm font-semibold text-[#17324D]">{label}</div>
                <div className="text-xs text-slate-500">Acces la widget si la conversatie</div>
              </div>
            </label>
          ))}
        </div>
      </DocumentSection>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#EEF4FB] text-[#17324D]">
              <Bot size={20} />
            </span>
            <div>
              <div className="text-sm font-semibold text-[#17324D]">Asistent contextual</div>
              <div className="text-sm text-slate-500">Intelege modulul si ruta deschisa.</div>
            </div>
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#E5F3E8] text-[#215D2A]">
              <ShieldCheck size={20} />
            </span>
            <div>
              <div className="text-sm font-semibold text-[#17324D]">Controlat si sigur</div>
              <div className="text-sm text-slate-500">Nu executa singur zone sensibile.</div>
            </div>
          </div>
        </div>
        <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#F6F1E7] text-[#7A5A24]">
              <CheckCircle2 size={20} />
            </span>
            <div>
              <div className="text-sm font-semibold text-[#17324D]">Pregatit pentru evolutie</div>
              <div className="text-sm text-slate-500">Putem adauga treptat actiuni reale.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
