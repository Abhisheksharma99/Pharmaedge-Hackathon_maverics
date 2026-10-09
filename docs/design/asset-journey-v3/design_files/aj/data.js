// Sample data for the Treprostinil onboarding run. Step names/labels mirror crawler/service/steps.py (PLANS.onboard).
(function () {
  const TODAY = '2026-10-09';
  const ASSET = {
    id: 'treprostinil', name: 'Treprostinil', company: 'United Therapeutics', mechanism: 'Prostacyclin analogue', modality: 'Small molecule',
    aliases: ['Remodulin', 'Tyvaso', 'Tyvaso DPI', 'Orenitram'], indications: ['Pulmonary arterial hypertension', 'PH-ILD'],
    investigational: ['Idiopathic pulmonary fibrosis'], approvalRegions: ['US', 'EU'],
  };
  const CAT = {
    regulatory: { label: 'Regulatory', icon: 'landmark', c: '#2347d9', soft: '#eef2fd' },
    clinical: { label: 'Clinical', icon: 'flask', c: '#0b7a6f', soft: '#e6f4f2' },
    safety: { label: 'Safety', icon: 'shield', c: '#b42318', soft: '#fef3f2' },
    company: { label: 'Company', icon: 'megaphone', c: '#e0620f', soft: '#fdeee4' },
    ip: { label: 'Patents', icon: 'stamp', c: '#6941c6', soft: '#f4f3ff' },
  };
  const COLL = {
    fda_records: { c: '#2347d9', tab: 'Regulatory' }, ema_records: { c: '#5873e8', tab: 'Regulatory' },
    trial_records: { c: '#0b7a6f', tab: 'Clinical' }, publication_records: { c: '#475467', tab: 'Publications' },
    conference_records: { c: '#7a5af8', tab: 'Conferences' }, patent_records: { c: '#6941c6', tab: 'Patents' },
    company_records: { c: '#e0620f', tab: 'Company IR' }, articles: { c: '#98a2b3', tab: 'News' },
  };

  const S = (name, label, short, icon, dur, recs, counts, extra) => ({ name, label, short, icon, dur, recs: recs || {}, counts, ...(extra || {}) });
  const STEPS = [
    S('regulatory', 'Regulatory (FDA, EMA)', 'FDA · EMA', 'landmark', 4, { fda_records: 44, ema_records: 12 }, { fda_submission: 38, fda_recall: 3, ema_epar: 4, ema_post_authorisation: 8 }, { src: 1 }),
    S('ema_chmp', 'EMA CHMP opinions (monthly meeting highlights)', 'EMA CHMP', 'landmark', 2.5, { ema_records: 6 }, { ema_chmp_opinion: 3, ema_chmp_highlight: 3 }, { src: 1 }),
    S('clinical', 'Clinical trials (ClinicalTrials.gov)', 'ClinicalTrials.gov', 'flask', 4, { trial_records: 74 }, { trials: 74, company_sponsored: 31, active: 9 }, { src: 1 }),
    S('publications', 'Publications (PubMed)', 'PubMed', 'book', 4, { publication_records: 210 }, { publications: 210, mentions: 164 }, { src: 1 }),
    S('conferences', 'Conference abstracts (ERS, ATS, CHEST)', 'ERS · ATS · CHEST', 'presentation', 3, { conference_records: 38 }, { abstracts: 38 }, { src: 1 }),
    S('company_site', 'Company website (pages, documents)', 'Company website', 'globe', 3, { company_records: 26 }, { company_page: 14, company_document: 9, prescribing_info: 3 }, { src: 1 }),
    S('company_news', 'Company press releases (newsroom)', 'Newsroom', 'megaphone', 3.5, { company_records: 112 }, { press_release: 112 }, { src: 1 }),
    S('news', 'Newswires and Bing News (AI-screened)', 'Newswires · Bing', 'newspaper', 4, { articles: 58 }, { discovered: 66, ingested: 41, headlines: 17, skipped: 8 }, { src: 1, warn: "2 articles couldn't be fetched (seekingalpha.com, pharmabiz.com) · kept as headlines" }),
    S('industry_news', 'Industry news (Fierce, Reuters, EMA, Google News, ...)', 'Industry news', 'newspaper', 3, { articles: 37 }, { articles: 37 }, { src: 1 }),
    S('journey', 'Journey events (rules)', 'Rules engine', 'route', 3.5, {}, { events: 0 }),
    S('ai_triage', 'AI triage of stored records', 'AI triage', 'filter', 4, {}, { triaged: 186, relevant: 74, dropped: 112 }),
    S('ai_events', 'AI event extraction and consolidation', 'Event extraction', 'sparkles', 5, {}, { extracted: 21, events: 0 }),
    S('index', 'Search index for Asset AI', 'Search index', 'database', 3, {}, { passages: 1240 }),
    S('competitors', 'Competitors (top 5, each crawled lightly)', 'Competitors', 'users', 4, {}, { competitors: 5 }, { src: 1 }),
    S('fda_calendar', 'FDA calendar (PDUFA dates, advisory committees)', 'FDA calendar', 'calendar', 2.5, { fda_records: 3 }, { pdufa: 1, advisory_committee: 2 }, { src: 1 }),
    S('patents', 'Patents (AdisInsight, PubChem, Google Patents)', 'Patents', 'stamp', 4, { patent_records: 18 }, { patents: 18, expiries: 6 }, { src: 1 }),
    S('finalize', 'Finalize (journey rebuild, suggested questions, ready)', 'Finalize', 'check', 3, {}, { events: 0, suggested_questions: 4 }),
  ];
  const STAGE = { regulatory: 'Collect', ema_chmp: 'Collect', clinical: 'Collect', publications: 'Collect', conferences: 'Collect', company_site: 'Collect', company_news: 'Collect', news: 'Collect', industry_news: 'Collect', journey: 'Build', ai_triage: 'Build', ai_events: 'Build', index: 'Build', competitors: 'Expand', fda_calendar: 'Expand', patents: 'Expand', finalize: 'Finalize' };
  const PLAN_T = 3;
  let t = PLAN_T;
  STEPS.forEach((s, i) => { s.i = i; s.stage = STAGE[s.name]; s.start = t; s.end = t + s.dur; t = s.end; });
  const TOTAL = t;
  const byName = Object.fromEntries(STEPS.map((s) => [s.name, s]));

  const E = (o) => ({ region: null, phase: null, nct_id: null, sponsor_is_company: null, is_milestone: false, merged: o.sources.length, ...o, sources: o.sources.map(([collection, record_key]) => ({ collection, record_key })) });
  const EVENTS = [
    E({ id: 'e01', date: '2002-05-21', category: 'regulatory', type: 'approval', significance: 'High', region: 'US', title: 'FDA approves Remodulin', summary: 'NDA021272 · United Therapeutics · continuous subcutaneous infusion for PAH (NYHA class II–IV) to diminish symptoms associated with exercise.', via: 'journey', sources: [['fda_records', 'NDA021272-ORIG-1']] }),
    E({ id: 'e02', date: '2004-11-23', category: 'regulatory', type: 'label_expansion', significance: 'High', region: 'US', title: 'FDA approves efficacy supplement for Remodulin', summary: 'NDA021272 supplement 4: intravenous infusion for patients who cannot tolerate subcutaneous administration.', via: 'journey', sources: [['fda_records', 'NDA021272-SUPPL-4']] }),
    E({ id: 'e03', date: '2005-06-01', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT00147199', sponsor_is_company: true, title: 'Phase 3 trial started: TRIUMPH I', summary: 'Inhaled treprostinil added to bosentan or sildenafil in PAH; primary endpoint 6-minute walk distance at week 12.', via: 'journey', sources: [['trial_records', 'NCT00147199']] }),
    E({ id: 'e04', date: '2006-05-15', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT00325403', sponsor_is_company: true, title: 'Phase 3 trial started: FREEDOM-C', summary: 'Oral treprostinil in PAH patients on background ERA and/or PDE-5 inhibitor therapy.', via: 'journey', sources: [['trial_records', 'NCT00325403']] }),
    E({ id: 'e05', date: '2008-03-14', category: 'safety', type: 'safety_communication', significance: 'Medium', region: 'US', title: 'Bloodstream infection risk with IV Remodulin added to label', summary: 'Warnings updated after reports of Gram-negative bloodstream infections in patients receiving IV treprostinil through central venous catheters.', via: 'ai_events', sources: [['company_records', 'pr-2008-03-14-remodulin-label'], ['publication_records', 'PMID18178842'], ['fda_records', 'NDA021272-SUPPL-11']] }),
    E({ id: 'e06', date: '2009-07-30', category: 'regulatory', type: 'approval', significance: 'High', region: 'US', title: 'FDA approves Tyvaso', summary: 'NDA022387 · inhalation solution via the Tyvaso Inhalation System for PAH (WHO Group 1) to improve exercise ability.', via: 'journey', sources: [['fda_records', 'NDA022387-ORIG-1']] }),
    E({ id: 'e07', date: '2009-09-08', category: 'company', type: 'launch', significance: 'Low', region: 'US', title: 'Tyvaso launches in the US', summary: 'United Therapeutics begins shipping Tyvaso to specialty pharmacy distributors.', via: 'ai_events', sources: [['company_records', 'pr-2009-09-08-tyvaso-launch'], ['articles', 'biospace-2009-09-tyvaso-launch']] }),
    E({ id: 'e08', date: '2012-06-01', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT01560624', sponsor_is_company: true, title: 'Phase 3 trial started: FREEDOM-EV', summary: 'Oral treprostinil as initial combination with one background oral therapy; event-driven, time to clinical worsening.', via: 'journey', sources: [['trial_records', 'NCT01560624']] }),
    E({ id: 'e09', date: '2012-10-23', category: 'regulatory', type: 'complete_response', significance: 'Medium', region: 'US', title: 'FDA issues complete response letter for oral treprostinil', summary: 'FDA asked for more data before approving the extended-release tablets; United Therapeutics planned to resubmit.', via: 'ai_events', sources: [['company_records', 'pr-2012-10-23-orenitram-crl'], ['articles', 'fierce-2012-10-ut-crl'], ['articles', 'reuters-2012-10-23-ut']] }),
    E({ id: 'e10', date: '2013-12-20', category: 'regulatory', type: 'approval', significance: 'High', region: 'US', title: 'FDA approves Orenitram', summary: 'NDA203496 · extended-release tablets for PAH (WHO Group 1) to improve exercise capacity.', via: 'journey', sources: [['fda_records', 'NDA203496-ORIG-1']] }),
    E({ id: 'e11', date: '2014-10-06', category: 'ip', type: 'patent_expiry', significance: 'High', title: 'Patent expiry: US 5,153,222 (treprostinil compound)', summary: 'The compound patent behind Remodulin expires; generic injection filings follow.', via: 'finalize', sources: [['patent_records', 'US5153222']] }),
    E({ id: 'e12', date: '2016-08-12', category: 'regulatory', type: 'label_update', significance: 'Low', region: 'US', title: 'Label update for Remodulin', summary: 'NDA021272 supplement 26', via: 'journey', sources: [['fda_records', 'NDA021272-SUPPL-26']] }),
    E({ id: 'e13', date: '2017-02-01', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT02630316', sponsor_is_company: true, title: 'Phase 3 trial started: INCREASE', summary: 'Inhaled treprostinil in pulmonary hypertension due to interstitial lung disease (WHO Group 3); 16-week 6MWD endpoint.', via: 'journey', sources: [['trial_records', 'NCT02630316']] }),
    E({ id: 'e14', date: '2017-03-14', category: 'ip', type: 'patent_granted', significance: 'Medium', title: 'Patent granted: US 9,593,066 (treprostinil production process)', summary: 'Process patent later asserted against Liquidia.', via: 'finalize', sources: [['patent_records', 'US9593066']] }),
    E({ id: 'e15', date: '2018-09-03', category: 'company', type: 'partnership', significance: 'Medium', title: 'Licensing deal with MannKind for treprostinil dry powder', summary: 'Worldwide exclusive licence to develop and commercialise a Technosphere dry-powder formulation, later Tyvaso DPI.', via: 'ai_events', sources: [['company_records', 'pr-2018-09-04-mannkind'], ['articles', 'fierce-2018-09-mannkind'], ['articles', 'globenewswire-2018-09-mannkind']] }),
    E({ id: 'e16', date: '2019-03-25', category: 'regulatory', type: 'generic_approval', significance: 'Medium', region: 'US', title: 'FDA approves generic Treprostinil (Sandoz)', summary: 'ANDA203649 · the first generic treprostinil injection reaches the US market.', via: 'journey', sources: [['fda_records', 'ANDA203649-ORIG-1']] }),
    E({ id: 'e17', date: '2019-10-18', category: 'regulatory', type: 'label_expansion', significance: 'High', region: 'US', title: 'FDA approves efficacy supplement for Orenitram', summary: 'NDA203496: label updated with FREEDOM-EV results; delays disease progression in PAH.', via: 'journey', sources: [['fda_records', 'NDA203496-SUPPL-6']] }),
    E({ id: 'e18', date: '2020-01-30', category: 'regulatory', type: 'regulatory_opinion', significance: 'Medium', region: 'EU', title: 'CHMP positive opinion: Trepulmix', summary: 'Subcutaneous treprostinil for inoperable or persistent chronic thromboembolic pulmonary hypertension (CTEPH). Sponsor: SciPharm.', via: 'journey', sources: [['ema_records', 'chmp-2020-01-trepulmix']] }),
    E({ id: 'e38', date: '2018-08-01', category: 'clinical', type: 'trial_start', significance: 'Medium', phase: 'Phase 2', nct_id: 'NCT03496623', sponsor_is_company: true, title: 'Phase 2 trial started: PERFECT (PH-COPD)', summary: 'Inhaled treprostinil in pulmonary hypertension due to COPD; the first test outside PAH and ILD.', via: 'journey', sources: [['trial_records', 'NCT03496623']] }),
    E({ id: 'e19', date: '2020-02-24', category: 'clinical', type: 'topline', significance: 'High', title: 'INCREASE meets primary endpoint in PH-ILD', summary: 'Placebo-corrected improvement in 6-minute walk distance at week 16; key secondary endpoints also met.', via: 'ai_events', sources: [['company_records', 'pr-2020-02-24-increase'], ['articles', 'biospace-2020-02-increase'], ['articles', 'fierce-2020-02-increase'], ['articles', 'reuters-2020-02-24-ut'], ['conference_records', 'ats-2020-increase']] }),
    E({ id: 'e20', date: '2020-04-03', category: 'regulatory', type: 'approval', significance: 'High', region: 'EU', title: 'EC approves Trepulmix for CTEPH', summary: 'EU marketing authorisation for adults with WHO FC III–IV inoperable or persistent CTEPH.', via: 'journey', sources: [['ema_records', 'EMEA-H-C-005207']] }),
    E({ id: 'e21', date: '2020-06-04', category: 'ip', type: 'litigation', significance: 'Medium', title: 'Patent suit filed against Liquidia over Yutrepia', summary: 'United Therapeutics asserts treprostinil patents against Liquidia’s dry-powder inhaled treprostinil.', via: 'ai_events', sources: [['company_records', 'pr-2020-06-04-liquidia'], ['articles', 'fierce-2020-06-liquidia'], ['articles', 'law360-2020-06-ut-liquidia']] }),
    E({ id: 'e22', date: '2020-07-21', category: 'ip', type: 'patent_granted', significance: 'Medium', title: 'Patent granted: US 10,716,793 (inhaled treprostinil)', summary: 'Method-of-treatment patent added to the Liquidia litigation.', via: 'finalize', sources: [['patent_records', 'US10716793']] }),
    E({ id: 'e23', date: '2021-01-13', category: 'clinical', type: 'publication', significance: 'Medium', title: 'INCREASE results published in NEJM', summary: 'Inhaled treprostinil improves exercise capacity in pulmonary hypertension due to interstitial lung disease.', via: 'ai_events', sources: [['publication_records', 'PMID33440084'], ['articles', 'medicaldialogues-73491'], ['articles', 'healio-2021-01-increase']] }),
    E({ id: 'e24', date: '2021-04-01', category: 'regulatory', type: 'label_expansion', significance: 'High', region: 'US', title: 'FDA approves efficacy supplement for Tyvaso', summary: 'NDA022387: pulmonary hypertension associated with interstitial lung disease (WHO Group 3), the first approved therapy for PH-ILD.', via: 'journey', sources: [['fda_records', 'NDA022387-SUPPL-17']] }),
    E({ id: 'e25', date: '2021-06-01', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT04708782', sponsor_is_company: true, title: 'Phase 3 trial started: TETON-1', summary: 'Inhaled treprostinil in idiopathic pulmonary fibrosis (US and Canada); primary endpoint change in FVC at week 52.', via: 'journey', sources: [['trial_records', 'NCT04708782']] }),
    E({ id: 'e26', date: '2022-04-01', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT05255991', sponsor_is_company: true, title: 'Phase 3 trial started: TETON-2', summary: 'Inhaled treprostinil in IPF outside North America; same design as TETON-1.', via: 'journey', sources: [['trial_records', 'NCT05255991']] }),
    E({ id: 'e27', date: '2022-05-23', category: 'regulatory', type: 'new_formulation', significance: 'High', region: 'US', title: 'FDA approves Tyvaso DPI', summary: 'NDA214324 · dry-powder inhaler for PAH and PH-ILD, developed with MannKind.', via: 'journey', sources: [['fda_records', 'NDA214324-ORIG-1']] }),
    E({ id: 'e28', date: '2022-06-15', category: 'clinical', type: 'trial_terminated', significance: 'Medium', phase: 'Phase 2', nct_id: 'NCT03496623', sponsor_is_company: true, title: 'PERFECT (PH-COPD) stopped early', summary: 'Study of inhaled treprostinil in PH due to COPD terminated after an interim analysis.', via: 'journey', sources: [['trial_records', 'NCT03496623']] }),
    E({ id: 'e29', date: '2023-07-11', category: 'regulatory', type: 'label_update', significance: 'Low', region: 'US', title: 'Label update for Tyvaso DPI', summary: 'NDA214324 supplement 4', via: 'journey', sources: [['fda_records', 'NDA214324-SUPPL-4']] }),
    E({ id: 'e30', date: '2023-08-01', category: 'clinical', type: 'trial_start', significance: 'High', phase: 'Phase 3', nct_id: 'NCT05943535', sponsor_is_company: true, title: 'Phase 3 trial started: TETON-PPF', summary: 'Inhaled treprostinil in progressive pulmonary fibrosis.', via: 'journey', sources: [['trial_records', 'NCT05943535']] }),
    E({ id: 'e31', date: '2023-12-20', category: 'ip', type: 'litigation', significance: 'High', title: 'Federal Circuit affirms invalidity of ’793 patent claims', summary: 'The appeals court upholds the PTAB decision, clearing a path for Liquidia’s Yutrepia.', via: 'ai_events', sources: [['articles', 'reuters-2023-12-20-liquidia'], ['articles', 'fierce-2023-12-liquidia'], ['company_records', 'pr-2023-12-20-statement'], ['articles', 'endpoints-2023-12-ut']] }),
    E({ id: 'e32', date: '2024-04-07', category: 'clinical', type: 'publication', significance: 'Low', title: 'INCREASE analysis links inhaled treprostinil to lower mortality', summary: 'Post-hoc analysis in patients with PH associated with ILD.', via: 'ai_events', sources: [['articles', 'medicaldialogues-126388'], ['publication_records', 'PMID38457204']] }),
    E({ id: 'e33', date: '2025-01-17', category: 'safety', type: 'recall', significance: 'High', region: 'US', title: 'FDA recall: Treprostinil Injection (Par Pharmaceutical), 7 lots', summary: 'Potential for silicone particulates in the product solution.', via: 'journey', sources: [['fda_records', 'RECALL-D-0312-2025']] }),
    E({ id: 'e34', date: '2025-09-02', category: 'clinical', type: 'topline', significance: 'High', title: 'TETON-2 meets primary endpoint in IPF', summary: 'Inhaled treprostinil slowed FVC decline versus placebo at week 52.', via: 'ai_events', sources: [['company_records', 'pr-2025-09-02-teton2'], ['articles', 'fierce-2025-09-teton2'], ['articles', 'biospace-2025-09-teton2'], ['articles', 'reuters-2025-09-02-ut'], ['articles', 'endpoints-2025-09-teton2'], ['trial_records', 'NCT05255991']] }),
    E({ id: 'e35', date: '2025-09-28', category: 'clinical', type: 'conference', significance: 'Medium', title: 'TETON-2 results presented at ERS Congress 2025', summary: 'Late-breaking abstract with FVC and exacerbation data.', via: 'ai_events', sources: [['conference_records', 'ers-2025-lb-teton2'], ['articles', 'healio-2025-09-ers-teton2']] }),
    E({ id: 'e36', date: '2026-09-30', category: 'regulatory', type: 'submission_accepted', significance: 'High', region: 'US', title: 'FDA accepts Tyvaso sNDA for idiopathic pulmonary fibrosis', summary: 'Supplemental application based on the TETON programme accepted for review.', via: 'ai_events', sources: [['articles', 'ajmc-fda-accepts-snda-ipf'], ['company_records', 'pr-2026-09-30-snda'], ['articles', 'fierce-2026-09-snda'], ['articles', 'biospace-2026-09-snda']] }),
    E({ id: 'e37', date: '2026-10-05', category: 'clinical', type: 'publication', significance: 'Low', title: 'Study highlights benefits of inhaled treprostinil in IPF', summary: 'Rare Disease Advisor coverage of new TETON analyses.', via: 'ai_events', sources: [['articles', 'rarediseaseadvisor-inhaled-treprostinil-ipf']] }),
    E({ id: 'm1', date: '2027-06-30', category: 'clinical', type: 'readout_expected', significance: 'High', phase: 'Phase 3', nct_id: 'NCT05943535', sponsor_is_company: true, is_milestone: true, title: 'Phase 3 readout expected: TETON-PPF', summary: 'Primary completion date from ClinicalTrials.gov.', via: 'journey', sources: [['trial_records', 'NCT05943535']] }),
    E({ id: 'm2', date: '2027-07-30', category: 'regulatory', type: 'regulatory_decision_expected', significance: 'High', region: 'US', is_milestone: true, title: 'FDA decision expected (PDUFA date): Tyvaso in IPF', summary: 'Goal date from the FDA calendar.', via: 'finalize', sources: [['fda_records', 'fdacal-2027-07-tyvaso-ipf']] }),
    E({ id: 'm3', date: '2028-03-14', category: 'ip', type: 'patent_expiry', significance: 'Medium', is_milestone: true, title: 'Patent expiry: US 9,593,066', summary: 'Process patent term ends (estimated from grant and term adjustments).', via: 'finalize', sources: [['patent_records', 'US9593066']] }),
  ];

  // When each event appears during the build: rules/AI/finalize process records chronologically.
  ['journey', 'ai_events', 'finalize'].forEach((via) => {
    const s = byName[via], list = EVENTS.filter((e) => e.via === via).sort((a, b) => a.date.localeCompare(b.date));
    list.forEach((e, i) => { e.at = s.start + s.dur * 0.06 + ((i + 0.5) / list.length) * s.dur * 0.86; });
  });
  byName.journey.counts.events = EVENTS.filter((e) => e.via === 'journey').length;
  byName.ai_events.counts.events = EVENTS.filter((e) => e.via === 'ai_events').length;
  byName.finalize.counts.events = EVENTS.length;

  // Raw records: deterministic pseudo-random dates per collection.
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const R = rng(42);
  const W = {
    fda_records: (y) => ([2002, 2004, 2009, 2013, 2019, 2021, 2022].includes(y) ? 6 : y >= 2002 ? 1 : 0),
    ema_records: (y) => (y >= 2019 ? 3 : y >= 2005 ? 0.6 : 0),
    trial_records: (y) => (y >= 2005 && y <= 2024 ? 3 : 1),
    publication_records: (y) => y - 1998,
    conference_records: (y) => (y >= 2010 ? y - 2008 : 0),
    patent_records: (y) => (y <= 2024 ? 1 : 0),
    company_records: (y) => (y >= 2004 ? y - 2002 : 0),
    articles: (y) => (y >= 2016 ? Math.pow(y - 2014, 1.6) : 0),
  };
  const YEARS = Array.from({ length: 27 }, (_, i) => 2000 + i);
  function sampleYear(coll) {
    const ws = YEARS.map(W[coll]), sum = ws.reduce((a, b) => a + b, 0);
    let r = R() * sum;
    for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return YEARS[i]; }
    return 2026;
  }
  const RECORDS = [];
  STEPS.forEach((s) => Object.entries(s.recs).forEach(([coll, n]) => {
    for (let i = 0; i < n; i++) {
      let y = s.name === 'fda_calendar' ? 2027 + R() * 0.8 : sampleYear(coll) + R();
      if (s.name !== 'fda_calendar') y = Math.min(y, 2026.76);
      RECORDS.push({ id: `${s.name}:${coll}:${i}`, step: s.name, coll, y, jitter: R(), at: s.start + s.dur * (0.04 + 0.9 * R()) });
    }
  }));
  RECORDS.sort((a, b) => a.at - b.at);

  const LOG = {
    regulatory: [[0.02, 'Querying openFDA Drugs@FDA for “treprostinil”'], [0.3, 'Found NDA021272 Remodulin · NDA022387 Tyvaso · NDA203496 Orenitram · NDA214324 Tyvaso DPI'], [0.62, 'Reading EMA EPARs and post-authorisation reports'], [0.97, 'Stored 44 FDA and 12 EMA records', 'done']],
    ema_chmp: [[0.05, 'Scanning CHMP monthly meeting highlights since 2005'], [0.95, '3 opinions mention treprostinil', 'done']],
    clinical: [[0.03, 'Searching ClinicalTrials.gov interventions: treprostinil, Remodulin, Tyvaso, Orenitram'], [0.45, '74 studies · 31 sponsored by United Therapeutics'], [0.97, '9 active, 3 in Phase 3', 'done']],
    publications: [[0.03, 'PubMed: treprostinil[tiab] OR Remodulin OR Tyvaso OR Orenitram'], [0.5, 'Fetching abstracts in batches of 50'], [0.97, '210 publications · 164 mention the asset in the abstract', 'done']],
    conferences: [[0.04, 'Crawling ERS, ATS and CHEST abstract archives'], [0.96, '38 abstracts stored', 'done']],
    company_site: [[0.04, 'Mapping unither.com: product pages, prescribing information, annual reports'], [0.96, '26 pages and documents stored', 'done']],
    company_news: [[0.04, 'Reading the United Therapeutics newsroom, newest first'], [0.6, 'Back to 2004 · 112 press releases'], [0.97, '112 press releases stored', 'done']],
    news: [[0.03, 'Bing News + PR Newswire, BioSpace, GlobeNewswire'], [0.4, 'Couldn’t fetch seekingalpha.com/article/4951584 · kept the headline', 'warn'], [0.55, 'Couldn’t fetch pharmabiz.com/NewsDetails.aspx?aid=168743 · kept the headline', 'warn'], [0.97, '41 ingested · 17 headlines · 8 skipped', 'done']],
    industry_news: [[0.04, 'Fierce Pharma, Reuters, EMA news, Google News'], [0.97, '37 articles stored', 'done']],
    journey: [[0.02, 'Mapping dated FDA, EMA and trial records to events by rule'], [0.98, `${byName.journey.counts.events} events from structured sources`, 'done']],
    ai_triage: [[0.03, 'Triaging 186 unstructured records'], [0.18, '“FDA Accepts Inhaled Treprostinil sNDA for IPF”', 'ai', 'Ingest'], [0.34, '“Study Highlights Benefits of Inhaled Treprostinil in IPF”', 'ai', 'Ingest'], [0.5, '“Comparison of treprostinil and oral sildenafil … newborn”', 'ai', 'Headline'], [0.66, '“Treprostinil Palmitil Market: Current Analysis and Forecast”', 'ai', 'Skip'], [0.8, '“Treprostinil – Side effect(s)”', 'ai', 'Skip'], [0.97, '74 relevant · 112 dropped', 'done']],
    ai_events: [[0.02, 'Extracting dated events from 74 relevant records'], [0.98, `21 candidates consolidated into ${byName.ai_events.counts.events} events`, 'done']],
    index: [[0.05, 'Chunking records for Asset AI'], [0.97, '1,240 passages indexed', 'done']],
    competitors: [[0.04, 'Ranking competitors by indication and mechanism'], [0.5, 'Yutrepia (Liquidia) · Uptravi (J&J) · Winrevair (Merck) · Veletri (J&J) · Ofev (Boehringer Ingelheim)'], [0.97, '5 competitors queued for a light crawl', 'done']],
    fda_calendar: [[0.05, 'Checking the FDA calendar for PDUFA dates and advisory committees'], [0.96, '1 PDUFA date ahead · 2 advisory committees', 'done']],
    patents: [[0.03, 'AdisInsight, PubChem and Google Patents'], [0.6, '18 patents · 6 expiries computed'], [0.97, 'Stored 18 patent records', 'done']],
    finalize: [[0.02, 'Rebuilding the journey with patents and FDA calendar'], [0.7, '4 suggested questions for Asset AI'], [0.99, `Asset ready · ${EVENTS.length} journey events`, 'done']],
  };
  const LOGS = [{ t: 0.1, step: 'plan', text: `Planning onboarding for Treprostinil · ${STEPS.length} steps`, kind: 'info' }];
  STEPS.forEach((s) => (LOG[s.name] || []).forEach(([f, text, kind, verdict]) => LOGS.push({ t: s.start + s.dur * f, step: s.name, text, kind: kind || 'info', verdict })));
  EVENTS.forEach((e) => LOGS.push({ t: e.at, step: e.via, kind: 'event', ev: e.id, text: e.title, merged: e.via === 'ai_events' ? e.sources.length : 0 }));
  LOGS.sort((a, b) => a.t - b.t);
  LOGS.forEach((l, i) => (l.id = i));

  window.AJ = { TODAY, ASSET, CAT, COLL, STEPS, byName, PLAN_T, TOTAL, EVENTS, RECORDS, LOGS, Y0: 2000, Y1: 2029 };
})();
