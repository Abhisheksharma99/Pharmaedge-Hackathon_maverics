/**
 * Standard abbreviations for indication names seen in the data: [abbreviation, display name, other spellings…].
 * Spellings are matched case-insensitively, ignoring apostrophes ("Crohn's" = "Crohn"), hyphens and commas;
 * an inverted MeSH name ("Colitis, Ulcerative") is also tried the natural way round.
 */
const ABBREVIATIONS: [string, string, ...string[]][] = [
  ['PAH', 'Pulmonary arterial hypertension'],
  ['PH', 'Pulmonary hypertension'],
  ['PH-ILD', 'Pulmonary hypertension associated with interstitial lung disease', 'Pulmonary hypertension due to interstitial lung disease', 'Pulmonary hypertension associated with ILD', 'Pulmonary hypertension due to ILD'],
  ['PH-COPD', 'Pulmonary hypertension associated with COPD', 'Pulmonary hypertension due to COPD', 'Pulmonary hypertension associated with chronic obstructive pulmonary disease'],
  ['CTEPH', 'Chronic thromboembolic pulmonary hypertension'],
  ['IPF', 'Idiopathic pulmonary fibrosis'],
  ['PPF', 'Progressive pulmonary fibrosis'],
  ['PF', 'Pulmonary fibrosis'],
  ['ILD', 'Interstitial lung disease', 'Interstitial lung diseases'],
  ['SSc-ILD', 'Systemic sclerosis-associated interstitial lung disease', 'Systemic sclerosis associated interstitial lung disease', 'Interstitial lung disease associated with systemic sclerosis'],
  ['COPD', 'Chronic obstructive pulmonary disease'],
  ['OSA', 'Obstructive sleep apnea', 'Obstructive sleep apnoea'],
  ['CKD', 'Chronic kidney disease', 'Chronic kidney diseases'],
  ['DKD', 'Diabetic kidney disease'],
  ['ESRD', 'End-stage renal disease', 'End stage kidney disease'],
  ['AKI', 'Acute kidney injury'],
  ['MS', 'Multiple sclerosis'],
  ['RMS', 'Relapsing multiple sclerosis', 'Relapsing forms of multiple sclerosis'],
  ['RRMS', 'Relapsing-remitting multiple sclerosis'],
  ['PPMS', 'Primary progressive multiple sclerosis'],
  ['SPMS', 'Secondary progressive multiple sclerosis'],
  ['CD', 'Crohn’s disease', 'Crohns disease'],
  ['UC', 'Ulcerative colitis'],
  ['IBD', 'Inflammatory bowel disease', 'Inflammatory bowel diseases', 'Inflamatory bowel disease'],
  ['RA', 'Rheumatoid arthritis'],
  ['JIA', 'Juvenile idiopathic arthritis'],
  ['pJIA', 'Polyarticular juvenile idiopathic arthritis'],
  ['SSc', 'Systemic sclerosis', 'Systemic scleroderma'],
  ['SLE', 'Systemic lupus erythematosus'],
  ['PsO', 'Psoriasis', 'Plaque psoriasis', 'Chronic plaque psoriasis'],
  ['PsA', 'Psoriatic arthritis', 'Psoriasis arthritis'],
  ['AS', 'Ankylosing spondylitis'],
  ['axSpA', 'Axial spondyloarthritis', 'Axial spondylarthritis'],
  ['SpA', 'Spondyloarthritis', 'Spondylarthritis'],
  ['AD', 'Atopic dermatitis'],
  ['HS', 'Hidradenitis suppurativa'],
  ['GCA', 'Giant cell arteritis'],
  ['HF', 'Heart failure'],
  ['HFrEF', 'Heart failure with reduced ejection fraction'],
  ['HFpEF', 'Heart failure with preserved ejection fraction'],
  ['HFmrEF', 'Heart failure with mildly reduced ejection fraction', 'Heart failure with mid-range ejection fraction'],
  ['CHF', 'Congestive heart failure'],
  ['RH', 'Resistant hypertension'],
  ['PA', 'Primary aldosteronism', 'Primary hyperaldosteronism'],
  ['AF', 'Atrial fibrillation'],
  ['MI', 'Myocardial infarction'],
  ['CAD', 'Coronary artery disease'],
  ['HCM', 'Hypertrophic cardiomyopathy'],
  ['T2D', 'Type 2 diabetes', 'Type 2 diabetes mellitus', 'Type II diabetes', 'Type II diabetes mellitus', 'Type2 diabetes', 'Type2 diabetes mellitus', 'Diabetes mellitus type 2', 'Diabetes mellitus type II', 'Diabetes type 2'],
  ['T1D', 'Type 1 diabetes', 'Type 1 diabetes mellitus', 'Diabetes mellitus type 1', 'Diabetes type 1'],
  ['NAFLD', 'Non-alcoholic fatty liver disease', 'Nonalcoholic fatty liver disease'],
  ['NASH', 'Non-alcoholic steatohepatitis', 'Nonalcoholic steatohepatitis'],
  ['DMD', 'Duchenne muscular dystrophy'],
  ['CLL', 'Chronic lymphocytic leukemia', 'Chronic lymphocytic leukaemia'],
  ['NSCLC', 'Non-small cell lung cancer', 'Non-small-cell lung carcinoma', 'Non-small cell lung carcinoma'],
  ['HCC', 'Hepatocellular carcinoma'],
  ['MM', 'Multiple myeloma'],
  ['PCOS', 'Polycystic ovary syndrome'],
]

/** "Crohn&#39;s Disease, " → "crohn disease": lower case, no apostrophes / "'s", hyphens and commas as spaces. */
const nameKey = (s: string) =>
  s
    .replace(/&#39;|[’´`]/g, "'")
    .toLowerCase()
    .replace(/'s\b/g, '')
    .replace(/'/g, '')
    .replace(/[\s,_-]+/g, ' ')
    .trim()

const SHORT = new Map(ABBREVIATIONS.flatMap(([abbr, ...names]) => names.map((n) => [nameKey(n), abbr] as const)))
/** Display names of the abbreviations, plus ones the data uses that are never abbreviated here ("Hypertension" stays). */
const FULL = new Map([...ABBREVIATIONS.map(([abbr, name]) => [abbr.toLowerCase(), name] as const), ['htn', 'Hypertension'] as const])

/**
 * An indication's standard short form: "Pulmonary arterial hypertension (PAH)" → "PAH", "IBD (Inflammatory bowel
 * disease)" → "IBD", "Idiopathic Pulmonary Fibrosis" / "Fibrosis, Idiopathic Pulmonary" → "IPF". Names without a
 * known abbreviation stay as they are.
 */
export function shortIndication(name: string): string {
  const s = name.trim()
  const trailing = s.match(/\(([^()]{1,10})\)\s*$/)?.[1]
  if (trailing) return trailing
  const leading = s.match(/^([A-Za-z0-9-]{2,10})\s*\([^()]+\)$/)?.[1]
  if (leading && /[A-Z].*[A-Z]/.test(leading)) return leading
  const inverted = s.match(/^([^,]+),([^,]+)$/)
  return SHORT.get(nameKey(s)) ?? (inverted ? SHORT.get(nameKey(`${inverted[2]} ${inverted[1]}`)) : undefined) ?? s
}

/** The display name of a known abbreviation ("PAH" → "Pulmonary arterial hypertension"), else undefined. */
export const indicationName = (short: string): string | undefined => FULL.get(short.trim().toLowerCase())

/** FDA submission status codes (AP, TA) read as words, like the prototype's Approved / Under review. */
const FDA_STATUS: Record<string, string> = { AP: 'Approved', TA: 'Tentative approval' }
export const fdaStatus = (s: string) => FDA_STATUS[s] ?? s
