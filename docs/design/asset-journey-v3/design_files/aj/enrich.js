// Enrichment for Treprostinil journey events: indications, products, structured details, impact, subtree links,
// and the 3D motif the AI picked for each event during ingestion (fx + rationale).
(function () {
  const D = {
    e01: { ind: ['PAH (NYHA II–IV)'], product: 'Remodulin', d: { Application: 'NDA021272', Route: 'Subcutaneous infusion', Sponsor: 'United Therapeutics', Pivotal: '2 × 12-week Phase 3 (n=470)' }, impact: 'First approval: establishes the treprostinil franchise in the US.', fx: 'crystal', why: 'first approval in a new region' },
    e02: { ind: ['PAH'], product: 'Remodulin IV', d: { Application: 'NDA021272 S-004', Route: 'Intravenous infusion', 'Approval type': 'Efficacy supplement' }, impact: 'Opens IV use for patients who cannot tolerate SC site pain.', fx: 'crystal', why: 'label expansion widens the eligible population' },
    e03: { ind: ['PAH'], product: 'Tyvaso (inhaled)', d: { Trial: 'NCT00147199', Phase: 'Phase 3', Enrollment: '235', 'Primary endpoint': '6MWD at week 12', Status: 'Completed', Sponsor: 'United Therapeutics' }, impact: 'Pivotal trial for the inhaled formulation.', fx: 'orbit', why: 'trial start: participants orbit a new hypothesis', links: ['e06'] },
    e04: { ind: ['PAH'], product: 'Orenitram (oral)', d: { Trial: 'NCT00325403', Phase: 'Phase 3', Enrollment: '350', 'Primary endpoint': '6MWD at week 16', Status: 'Completed' }, impact: 'First oral programme; missed its primary endpoint.', fx: 'orbit', why: 'trial start', links: ['e09'] },
    e05: { ind: ['PAH'], product: 'Remodulin IV', d: { Signal: 'Gram-negative bloodstream infections', Source: 'CDC report + label update', Region: 'US' }, impact: 'Boxed-style warning steers IV patients to SC or later inhaled options.', fx: 'beacon', why: 'safety signal: a warning beacon' },
    e06: { ind: ['PAH (WHO Group 1)'], product: 'Tyvaso', d: { Application: 'NDA022387', Route: 'Inhaled (nebuliser)', 'Pivotal trial': 'TRIUMPH I', Sponsor: 'United Therapeutics' }, impact: 'Second product and first inhaled prostacyclin from the company.', fx: 'crystal', why: 'new product approval', links: ['e03', 'e07'] },
    e07: { ind: ['PAH'], product: 'Tyvaso', d: { Channel: 'Specialty pharmacy', Region: 'US' }, impact: 'Commercial availability.', fx: 'spark', why: 'commercial launch: small spark, low significance' },
    e08: { ind: ['PAH'], product: 'Orenitram', d: { Trial: 'NCT01560624', Phase: 'Phase 3', Enrollment: '690', 'Primary endpoint': 'Time to clinical worsening', Status: 'Completed' }, impact: 'Outcomes trial later used to expand the Orenitram label.', fx: 'orbit', why: 'event-driven trial start', links: ['e17'] },
    e09: { ind: ['PAH'], product: 'Orenitram', d: { Action: 'Complete response letter', 'Review cycle': '1st', Region: 'US' }, impact: 'Delays the oral launch by about a year.', fx: 'shatter', why: 'regulatory setback: the path fractures before re-forming' },
    e10: { ind: ['PAH (WHO Group 1)'], product: 'Orenitram', d: { Application: 'NDA203496', Route: 'Oral, extended-release', 'Pivotal trial': 'FREEDOM-M' }, impact: 'Completes a three-route franchise: SC/IV, inhaled and oral.', fx: 'crystal', why: 'new product approval after a CRL', links: ['e04', 'e09'] },
    e11: { ind: ['All treprostinil products'], product: 'Compound patent', d: { Patent: 'US 5,153,222', Type: 'Compound', Status: 'Expired' }, impact: 'Opens the door to generic injectable treprostinil.', fx: 'lattice', why: 'IP boundary dissolving', links: ['e16'] },
    e12: { ind: ['PAH'], product: 'Remodulin', d: { Application: 'NDA021272 S-026', Class: 'Labeling' }, impact: 'Routine label maintenance.', fx: 'spark', why: 'low-significance label update' },
    e13: { ind: ['PH-ILD (WHO Group 3)'], product: 'Tyvaso', d: { Trial: 'NCT02630316', Phase: 'Phase 3', Enrollment: '326', 'Primary endpoint': '6MWD at week 16', Status: 'Completed' }, impact: 'Tests inhaled treprostinil in a population with no approved therapy.', fx: 'orbit', why: 'trial in a new indication', links: ['e19', 'e23', 'e24', 'e32'] },
    e14: { ind: ['All treprostinil products'], product: 'Process patent', d: { Patent: 'US 9,593,066', Type: 'Manufacturing process', Status: 'Granted', Expiry: '2028 (est.)' }, impact: 'Later asserted against Liquidia.', fx: 'lattice', why: 'patent grant: protective lattice', links: ['e21', 'm3'] },
    e15: { ind: ['PAH', 'PH-ILD'], product: 'Tyvaso DPI (in development)', d: { Partner: 'MannKind', Technology: 'Technosphere dry powder', Scope: 'Worldwide exclusive licence' }, impact: 'Origin of the Tyvaso DPI franchise.', fx: 'merge', why: 'partnership: two bodies merging', links: ['e27'] },
    e16: { ind: ['PAH'], product: 'Generic treprostinil injection', d: { Application: 'ANDA203649', Sponsor: 'Sandoz', Region: 'US' }, impact: 'Generic erosion of Remodulin revenue begins.', fx: 'shatter', why: 'competitive erosion of an approved product', links: ['e11'] },
    e17: { ind: ['PAH'], product: 'Orenitram', d: { Application: 'NDA203496 S-006', Class: 'Efficacy', Basis: 'FREEDOM-EV' }, impact: 'Orenitram label adds delay in disease progression.', fx: 'crystal', why: 'outcomes-based label expansion', links: ['e08'] },
    e18: { ind: ['CTEPH'], product: 'Trepulmix', d: { Opinion: 'Positive', Sponsor: 'SciPharm', Region: 'EU' }, impact: 'Treprostinil enters CTEPH in Europe.', fx: 'pulse', why: 'positive opinion: a forward pulse', links: ['e20'] },
    e19: { ind: ['PH-ILD'], product: 'Tyvaso', d: { Trial: 'INCREASE', Result: 'Primary endpoint met', 'Effect size': '+31 m 6MWD (placebo-corrected)' }, impact: 'Sets up the PH-ILD supplement and first-in-class position.', fx: 'pulse', why: 'positive topline: energy radiating outward', links: ['e13', 'e24'] },
    e20: { ind: ['CTEPH (WHO FC III–IV)'], product: 'Trepulmix', d: { Procedure: 'EMEA/H/C/005207', Sponsor: 'SciPharm', Region: 'EU' }, impact: 'First EU-wide authorisation for SC treprostinil.', fx: 'crystal', why: 'first approval in a new region', links: ['e18'] },
    e21: { ind: ['PAH', 'PH-ILD'], product: 'Tyvaso DPI vs Yutrepia', d: { Defendant: 'Liquidia', Court: 'D. Delaware', Patents: '’066, ’901, ’793' }, impact: 'Litigation shapes the timing of Yutrepia’s entry.', fx: 'lattice', why: 'IP defence', links: ['e22', 'e31'] },
    e22: { ind: ['PH-ILD'], product: 'Tyvaso · Tyvaso DPI', d: { Patent: 'US 10,716,793', Type: 'Method of treatment', Status: 'Claims later invalidated' }, impact: 'Key patent in the Liquidia case.', fx: 'lattice', why: 'patent grant', links: ['e31'] },
    e23: { ind: ['PH-ILD'], product: 'Tyvaso', d: { Journal: 'NEJM 2021;384:325-334', PMID: '33440084', Trial: 'INCREASE' }, impact: 'Peer-reviewed evidence behind the PH-ILD label.', fx: 'pages', why: 'publication: pages unfolding', links: ['e13'] },
    e24: { ind: ['PH-ILD (WHO Group 3)'], product: 'Tyvaso', d: { Application: 'NDA022387 S-017', Class: 'Efficacy', Basis: 'INCREASE' }, impact: 'First and only approved therapy for PH-ILD at the time.', fx: 'crystal', why: 'first-in-indication approval', links: ['e13', 'e19'] },
    e25: { ind: ['IPF'], product: 'Tyvaso', d: { Trial: 'NCT04708782', Phase: 'Phase 3', Enrollment: '~600 (target)', 'Primary endpoint': 'Change in FVC at week 52', Status: 'Active, not recruiting' }, impact: 'Moves treprostinil from vascular to fibrotic lung disease.', fx: 'orbit', why: 'trial in a new indication', links: ['e36'] },
    e26: { ind: ['IPF'], product: 'Tyvaso', d: { Trial: 'NCT05255991', Phase: 'Phase 3', Enrollment: '~600 (target)', 'Primary endpoint': 'Change in FVC at week 52', Region: 'Ex-North America' }, impact: 'Second pivotal IPF study.', fx: 'orbit', why: 'trial start', links: ['e34', 'e35', 'e36'] },
    e27: { ind: ['PAH', 'PH-ILD'], product: 'Tyvaso DPI', d: { Application: 'NDA214324', Route: 'Dry-powder inhaler', Partner: 'MannKind' }, impact: 'Convenience upgrade that becomes the growth driver.', fx: 'crystal', why: 'new formulation approval', links: ['e15', 'e29'] },
    e28: { ind: ['PH-COPD'], product: 'Tyvaso', d: { Trial: 'NCT03496623', Phase: 'Phase 2', Status: 'Terminated', Reason: 'Interim analysis' }, impact: 'Closes the COPD indication path.', fx: 'shatter', why: 'trial stopped early', links: ['e38'] },
    e38: { ind: ['PH-COPD'], product: 'Tyvaso', d: { Trial: 'NCT03496623', Phase: 'Phase 2', Enrollment: '141', 'Primary endpoint': '6MWD at week 12', Status: 'Terminated in 2022' }, impact: 'Opens a COPD branch for the inhaled franchise.', links: ['e28'] },
    e29: { ind: ['PAH', 'PH-ILD'], product: 'Tyvaso DPI', d: { Application: 'NDA214324 S-004', Class: 'Labeling' }, impact: 'Routine label update.', fx: 'spark', why: 'low-significance label update' },
    e30: { ind: ['PPF'], product: 'Tyvaso', d: { Trial: 'NCT05943535', Phase: 'Phase 3', Enrollment: '~700 (target)', 'Primary endpoint': 'Change in FVC at week 52', Status: 'Recruiting' }, impact: 'Extends the fibrosis strategy beyond IPF.', fx: 'orbit', why: 'trial in a new indication', links: ['m1'] },
    e31: { ind: ['PH-ILD'], product: 'Tyvaso DPI vs Yutrepia', d: { Court: 'Federal Circuit', Outcome: 'PTAB invalidity affirmed', Patent: 'US 10,716,793' }, impact: 'Removes a barrier to Yutrepia’s approval.', fx: 'shatter', why: 'IP loss: the lattice breaks', links: ['e21', 'e22'] },
    e32: { ind: ['PH-ILD'], product: 'Tyvaso', d: { Analysis: 'Post-hoc', Population: 'INCREASE' }, impact: 'Supportive mortality signal.', fx: 'pages', why: 'publication' },
    e33: { ind: ['PAH'], product: 'Treprostinil injection (Par)', d: { Class: 'Recall · 7 lots', Reason: 'Silicone particulates', Region: 'US' }, impact: 'Generic supply disruption; not a United Therapeutics product.', fx: 'beacon', why: 'safety recall: red beacon' },
    e34: { ind: ['IPF'], product: 'Tyvaso', d: { Trial: 'TETON-2', Result: 'Primary endpoint met', Endpoint: 'FVC decline at week 52' }, impact: 'First positive Phase 3 for an inhaled therapy in IPF.', fx: 'pulse', why: 'positive pivotal readout', links: ['e26', 'e35', 'e36'] },
    e35: { ind: ['IPF'], product: 'Tyvaso', d: { Congress: 'ERS 2025', Format: 'Late-breaking abstract' }, impact: 'Data in front of the respiratory community.', fx: 'constellation', why: 'conference: a constellation of abstracts', links: ['e34'] },
    e36: { ind: ['IPF'], product: 'Tyvaso', d: { Submission: 'sNDA', Basis: 'TETON-1 and TETON-2', Region: 'US' }, impact: 'Sets the PDUFA clock for a potential IPF label.', fx: 'pulse', why: 'filing accepted: momentum toward a decision', links: ['e25', 'e26', 'e34', 'm2'] },
    e37: { ind: ['IPF'], product: 'Tyvaso', d: { Outlet: 'Rare Disease Advisor' }, impact: 'Media coverage.', fx: 'spark', why: 'minor coverage' },
    m1: { ind: ['PPF'], product: 'Tyvaso', d: { Trial: 'NCT05943535', Source: 'Primary completion date' }, impact: 'Second fibrosis label opportunity.', fx: 'ghost', why: 'expected, not yet happened', links: ['e30'] },
    m2: { ind: ['IPF'], product: 'Tyvaso', d: { Type: 'PDUFA goal date', Source: 'FDA calendar' }, impact: 'Decision on the largest label expansion in the franchise’s history.', fx: 'ghost', why: 'expected decision', links: ['e36', 'e34'] },
    m3: { ind: ['All treprostinil products'], product: 'Process patent', d: { Patent: 'US 9,593,066', Source: 'Grant date + term' }, impact: 'Further generic exposure.', fx: 'ghost', why: 'expected expiry', links: ['e14'] },
  };
  const FX = { crystal: 'Crystal', orbit: 'Orbit', pulse: 'Pulse', pages: 'Pages', constellation: 'Constellation', lattice: 'Lattice', shatter: 'Shatter', beacon: 'Beacon', merge: 'Merge', ghost: 'Ghost', spark: 'Spark' };
  const FX_BY_TYPE = { approval: 'crystal', label_expansion: 'crystal', new_formulation: 'crystal', trial_start: 'orbit', topline: 'pulse', publication: 'pages', conference: 'constellation', patent_granted: 'lattice', patent_expiry: 'lattice', litigation: 'lattice', recall: 'beacon', safety_communication: 'beacon', partnership: 'merge', acquisition: 'merge', complete_response: 'shatter', trial_terminated: 'shatter', submission_accepted: 'pulse', regulatory_opinion: 'pulse' };
  const byId = Object.fromEntries(AJ.EVENTS.map((e) => [e.id, e]));
  function enrich(e, extra) {
    const x = extra || {};
    e.ind = e.ind || x.ind || [];
    e.product = e.product || x.product || null;
    e.details = e.details || x.d || {};
    e.impact = e.impact || x.impact || null;
    e.fx = e.fx || x.fx || (e.is_milestone ? 'ghost' : FX_BY_TYPE[e.type] || 'spark');
    e.fxWhy = e.fxWhy || x.why || 'matched by event type';
    e.links = e.links || x.links || [];
    return e;
  }
  AJ.EVENTS.forEach((e) => enrich(e, D[e.id]));

  /** Subtree under a card: evidence records, structured facts and linked journey events. */
  function tree(e, pool) {
    const idx = Object.fromEntries((pool || AJ.EVENTS).map((x) => [x.id, x]));
    const kids = [];
    if (!e.sources.length) kids.push({ t: 'Added manually', k: 'flag', c: [{ t: (e.user && e.user.by) || 'Team member', s: e.user && e.user.created.slice(0, 10), k: 'dot' }] });
    else if (e.sources.length > 1) kids.push({ t: `Consolidated from ${e.sources.length} records`, k: 'merge', c: e.sources.map((s) => ({ t: s.record_key, s: s.collection, k: 'file', coll: s.collection })) });
    else kids.push({ t: e.sources[0].record_key, s: e.sources[0].collection, k: 'file', coll: e.sources[0].collection, c: Object.entries(e.details || {}).slice(0, 4).map(([k, v]) => ({ t: v, s: k, k: 'dot' })) });
    if (e.ind && e.ind.length) kids.push({ t: 'Indications', k: 'flag', c: e.ind.map((i) => ({ t: i, k: 'dot' })) });
    const linked = (e.links || []).map((id) => idx[id]).filter(Boolean);
    if (linked.length) kids.push({ t: 'Linked journey events', k: 'route', c: linked.map((l) => ({ t: l.title, s: l.is_milestone ? `expected ${l.date.slice(0, 7)}` : l.date, k: 'ev', ev: l.id, cat: l.category })) });
    return kids;
  }
  // Indication branches: PAH is the trunk; each new indication forks from the programme that led to it.
  const BRANCHES = {
    treprostinil: [
      { id: 'PAH', label: 'PAH', full: 'Pulmonary arterial hypertension', c: '#2347d9', off: 0, trunk: true, status: 'Approved · US, EU' },
      { id: 'PH-ILD', label: 'PH-ILD', full: 'PH due to interstitial lung disease', c: '#0b7a6f', off: 1, from: 'PAH', status: 'Approved · US', why: 'INCREASE took inhaled treprostinil into WHO Group 3' },
      { id: 'IPF', label: 'IPF', full: 'Idiopathic pulmonary fibrosis', c: '#6941c6', off: 2, from: 'PH-ILD', status: 'sNDA under review', why: 'FVC gains seen in INCREASE led to the TETON programme' },
      { id: 'PPF', label: 'PPF', full: 'Progressive pulmonary fibrosis', c: '#e0620f', off: 3, from: 'IPF', status: 'Phase 3 recruiting', why: 'TETON-PPF extends the IPF approach to other fibrosing ILDs' },
      { id: 'CTEPH', label: 'CTEPH', full: 'Chronic thromboembolic PH', c: '#0e7490', off: -1, from: 'PAH', status: 'Approved · EU (SciPharm)', why: 'Subcutaneous treprostinil studied in inoperable CTEPH' },
      { id: 'PH-COPD', label: 'PH-COPD', full: 'PH due to COPD', c: '#b54708', off: -2, from: 'PAH', ended: 'Terminated', status: 'Closed · PERFECT terminated', why: 'PERFECT tested inhaled treprostinil in PH-COPD' },
    ],
  };
  const LANE_OF = { e13: 'PH-ILD', e19: 'PH-ILD', e22: 'PH-ILD', e23: 'PH-ILD', e24: 'PH-ILD', e31: 'PH-ILD', e32: 'PH-ILD', e25: 'IPF', e26: 'IPF', e34: 'IPF', e35: 'IPF', e36: 'IPF', e37: 'IPF', m2: 'IPF', e30: 'PPF', m1: 'PPF', e18: 'CTEPH', e20: 'CTEPH', e38: 'PH-COPD', e28: 'PH-COPD' };
  const SPAN = { e15: ['PAH', 'PH-ILD'], e21: ['PAH', 'PH-ILD'], e27: ['PAH', 'PH-ILD'], m3: ['PAH', 'PH-ILD', 'IPF', 'PPF'] };
  Object.assign(AJ, { FX, FX_BY_TYPE, enrich, tree, byEvent: byId, BRANCHES, LANE_OF, SPAN });
})();
