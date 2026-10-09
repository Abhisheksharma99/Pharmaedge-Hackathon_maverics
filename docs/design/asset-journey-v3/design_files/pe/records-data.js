// Source-record tables for each asset tab. Treprostinil rows are curated sample data; others derive from their events.
(function () {
  const T = (nct, name, title, phase, status, ind, sponsor, co, n, start, pcd) => ({ key: nct, nct, name, title, phase, status, ind, sponsor, co, n, start, pcd });
  const trials = [
    T('NCT00147199', 'TRIUMPH I', 'Inhaled treprostinil added to bosentan or sildenafil in PAH', 'Phase 3', 'Completed', 'PAH', 'United Therapeutics', true, 235, '2005-06', '2007-12'),
    T('NCT00325403', 'FREEDOM-C', 'Oral treprostinil with background ERA and/or PDE-5i', 'Phase 3', 'Completed', 'PAH', 'United Therapeutics', true, 350, '2006-05', '2008-12'),
    T('NCT00325442', 'FREEDOM-M', 'Oral treprostinil monotherapy in treatment-naive PAH', 'Phase 3', 'Completed', 'PAH', 'United Therapeutics', true, 349, '2006-08', '2011-05'),
    T('NCT00887978', 'FREEDOM-C2', 'Oral treprostinil with background therapy, flexible titration', 'Phase 3', 'Completed', 'PAH', 'United Therapeutics', true, 310, '2009-06', '2011-06'),
    T('NCT01560624', 'FREEDOM-EV', 'Oral treprostinil as initial combination; time to clinical worsening', 'Phase 3', 'Completed', 'PAH', 'United Therapeutics', true, 690, '2012-06', '2019-01'),
    T('NCT02630316', 'INCREASE', 'Inhaled treprostinil in PH due to interstitial lung disease', 'Phase 3', 'Completed', 'PH-ILD', 'United Therapeutics', true, 326, '2017-02', '2019-12'),
    T('NCT03496623', 'PERFECT', 'Inhaled treprostinil in PH due to COPD', 'Phase 2', 'Terminated', 'PH-COPD', 'United Therapeutics', true, 141, '2018-08', '2022-06'),
    T('NCT03950739', 'BREEZE', 'Switching from Tyvaso to Tyvaso DPI', 'Phase 1', 'Completed', 'PAH', 'United Therapeutics', true, 51, '2019-05', '2020-04'),
    T('NCT04708782', 'TETON-1', 'Inhaled treprostinil in idiopathic pulmonary fibrosis (US, Canada)', 'Phase 3', 'Active, not recruiting', 'IPF', 'United Therapeutics', true, 597, '2021-06', '2026-03'),
    T('NCT05255991', 'TETON-2', 'Inhaled treprostinil in IPF (outside North America)', 'Phase 3', 'Completed', 'IPF', 'United Therapeutics', true, 627, '2022-04', '2025-06'),
    T('NCT05943535', 'TETON-PPF', 'Inhaled treprostinil in progressive pulmonary fibrosis', 'Phase 3', 'Recruiting', 'PPF', 'United Therapeutics', true, 698, '2023-08', '2027-06'),
    T('NCT04791514', '—', 'Treprostinil in paediatric pulmonary arterial hypertension', 'Phase 2', 'Recruiting', 'PAH (paediatric)', 'Children’s Hospital Colorado', false, 40, '2021-03', '2026-12'),
    T('NCT03835676', '—', 'Inhaled treprostinil in PH due to left heart disease', 'Phase 2', 'Unknown', 'PH-LHD', 'University of Pittsburgh', false, 60, '2019-02', '2021-12'),
    T('NCT02891954', '—', 'Treprostinil for portopulmonary hypertension', 'Phase 4', 'Completed', 'PoPH', 'Mayo Clinic', false, 25, '2016-09', '2019-08'),
  ];
  const R = (date, region, type, app, product, cls, status, ev) => ({ key: app + date, date, region, type, app, product, cls, status, ev });
  const regulatory = [
    R('2002-05-21', 'US', 'FDA submission', 'NDA021272 ORIG-1', 'Remodulin', 'Original', 'Approved', 'e01'),
    R('2004-11-23', 'US', 'FDA submission', 'NDA021272 S-004', 'Remodulin', 'Efficacy', 'Approved', 'e02'),
    R('2008-03-14', 'US', 'FDA submission', 'NDA021272 S-011', 'Remodulin', 'Labeling', 'Approved', 'e05'),
    R('2009-07-30', 'US', 'FDA submission', 'NDA022387 ORIG-1', 'Tyvaso', 'Original', 'Approved', 'e06'),
    R('2012-10-23', 'US', 'FDA action', 'NDA203496', 'Orenitram', 'Original', 'Complete response', 'e09'),
    R('2013-12-20', 'US', 'FDA submission', 'NDA203496 ORIG-1', 'Orenitram', 'Original', 'Approved', 'e10'),
    R('2016-08-12', 'US', 'FDA submission', 'NDA021272 S-026', 'Remodulin', 'Labeling', 'Approved', 'e12'),
    R('2019-03-25', 'US', 'FDA submission', 'ANDA203649 ORIG-1', 'Treprostinil (Sandoz)', 'Generic', 'Approved', 'e16'),
    R('2019-10-18', 'US', 'FDA submission', 'NDA203496 S-006', 'Orenitram', 'Efficacy', 'Approved', 'e17'),
    R('2020-01-30', 'EU', 'CHMP opinion', 'EMEA/H/C/005207', 'Trepulmix', 'Initial MAA', 'Positive opinion', 'e18'),
    R('2020-04-03', 'EU', 'EC decision', 'EMEA/H/C/005207', 'Trepulmix', 'Initial MAA', 'Authorised', 'e20'),
    R('2021-04-01', 'US', 'FDA submission', 'NDA022387 S-017', 'Tyvaso', 'Efficacy', 'Approved', 'e24'),
    R('2022-05-23', 'US', 'FDA submission', 'NDA214324 ORIG-1', 'Tyvaso DPI', 'Type 3 · new dosage form', 'Approved', 'e27'),
    R('2023-07-11', 'US', 'FDA submission', 'NDA214324 S-004', 'Tyvaso DPI', 'Labeling', 'Approved', 'e29'),
    R('2025-01-17', 'US', 'FDA recall', 'D-0312-2025', 'Treprostinil inj. (Par)', 'Class II', 'Ongoing', 'e33'),
    R('2026-09-30', 'US', 'FDA submission', 'NDA022387 sNDA', 'Tyvaso', 'Efficacy · IPF', 'Under review', 'e36'),
    R('2027-07-30', 'US', 'FDA calendar', 'PDUFA goal date', 'Tyvaso', 'Efficacy · IPF', 'Expected', 'm2'),
  ];
  const P = (pmid, title, journal, year, type, ev) => ({ key: pmid, pmid, title, journal, year, type, ev });
  const publications = [
    P('PMID11897647', 'Continuous subcutaneous infusion of treprostinil in pulmonary arterial hypertension: a double-blind, randomized, placebo-controlled trial', 'Am J Respir Crit Care Med', 2002, 'RCT'),
    P('PMID18178842', 'Bloodstream infections among patients treated with intravenous epoprostenol or intravenous treprostinil', 'MMWR', 2007, 'Surveillance', 'e05'),
    P('PMID20430262', 'Addition of inhaled treprostinil to oral therapy for pulmonary arterial hypertension (TRIUMPH I)', 'J Am Coll Cardiol', 2010, 'RCT'),
    P('PMID22628490', 'Oral treprostinil for PAH in patients on background ERA and/or PDE-5 inhibitor therapy (FREEDOM-C)', 'Chest', 2012, 'RCT'),
    P('PMID23669822', 'Oral treprostinil as monotherapy for PAH (FREEDOM-M)', 'Circulation', 2013, 'RCT'),
    P('PMID32255694', 'Oral treprostinil in newly diagnosed PAH patients on monotherapy (FREEDOM-EV)', 'Circulation', 2020, 'RCT', 'e17'),
    P('PMID33440084', 'Inhaled treprostinil in pulmonary hypertension due to interstitial lung disease', 'N Engl J Med', 2021, 'RCT', 'e23'),
    P('PMID35385630', 'Safety and tolerability of treprostinil inhalation powder in PAH (BREEZE)', 'Pulm Circ', 2022, 'Open-label'),
    P('PMID38457204', 'Inhaled treprostinil and mortality in PH-ILD: post-hoc analysis of INCREASE', 'Chest', 2024, 'Post-hoc', 'e32'),
  ];
  const C = (congress, date, title, type, ev) => ({ key: congress + title.slice(0, 12), congress, date, title, type, ev });
  const conferences = [
    C('ATS 2020', '2020-05-17', 'INCREASE: inhaled treprostinil in PH-ILD, primary results', 'Late-breaking', 'e19'),
    C('ERS 2020', '2020-09-07', 'INCREASE: FVC change in the idiopathic interstitial pneumonia subgroup', 'Oral'),
    C('CHEST 2021', '2021-10-18', 'Real-world titration of inhaled treprostinil in PH-ILD', 'Poster'),
    C('ATS 2023', '2023-05-21', 'BREEZE open-label extension: long-term Tyvaso DPI tolerability', 'Poster'),
    C('ERS 2024', '2024-09-09', 'INCREASE open-label extension: exacerbations and survival', 'Oral'),
    C('ERS 2025', '2025-09-28', 'TETON-2: inhaled treprostinil in idiopathic pulmonary fibrosis', 'Late-breaking', 'e35'),
    C('CHEST 2025', '2025-10-20', 'Persistence on Tyvaso DPI versus nebulised Tyvaso', 'Poster'),
  ];
  const documents = [
    { key: 'pi-remodulin', title: 'Remodulin prescribing information', type: 'Prescribing info', date: '2024-03-12', pages: 28 },
    { key: 'pi-tyvaso', title: 'Tyvaso prescribing information', type: 'Prescribing info', date: '2024-05-02', pages: 22 },
    { key: 'pi-tyvaso-dpi', title: 'Tyvaso DPI prescribing information', type: 'Prescribing info', date: '2023-07-11', pages: 19 },
    { key: 'pi-orenitram', title: 'Orenitram prescribing information', type: 'Prescribing info', date: '2023-11-30', pages: 24 },
    { key: '10k-2025', title: 'Annual report (Form 10-K) 2025', type: 'Annual report', date: '2026-02-24', pages: 142 },
    { key: '10k-2024', title: 'Annual report (Form 10-K) 2024', type: 'Annual report', date: '2025-02-25', pages: 138 },
    { key: 'ir-q2-2026', title: 'Investor presentation, Q2 2026', type: 'Company document', date: '2026-07-29', pages: 36 },
    { key: 'pipeline-2026', title: 'Pipeline overview', type: 'Company page', date: '2026-08-04', pages: 1 },
  ];
  const PR = (date, title, cat, ev) => ({ key: 'pr-' + date, date, title, cat, ev });
  const ir = [
    PR('2026-09-30', 'FDA accepts supplemental NDA for Tyvaso in idiopathic pulmonary fibrosis', 'Regulatory', 'e36'),
    PR('2026-07-29', 'United Therapeutics reports second quarter 2026 financial results', 'Financial'),
    PR('2025-09-02', 'TETON-2 meets primary endpoint in idiopathic pulmonary fibrosis', 'Clinical', 'e34'),
    PR('2023-12-20', 'Statement on the Federal Circuit decision regarding the ’793 patent', 'Legal', 'e31'),
    PR('2022-05-23', 'FDA approves Tyvaso DPI', 'Regulatory', 'e27'),
    PR('2021-04-01', 'FDA approves Tyvaso for PH associated with interstitial lung disease', 'Regulatory', 'e24'),
    PR('2020-06-04', 'United Therapeutics files patent infringement suit against Liquidia', 'Legal', 'e21'),
    PR('2020-02-24', 'INCREASE study of Tyvaso in PH-ILD meets primary endpoint', 'Clinical', 'e19'),
    PR('2018-09-04', 'Licence agreement with MannKind for treprostinil Technosphere', 'Business', 'e15'),
    PR('2013-12-20', 'FDA approves Orenitram extended-release tablets', 'Regulatory', 'e10'),
    PR('2012-10-23', 'Complete response letter for oral treprostinil', 'Regulatory', 'e09'),
    PR('2009-07-30', 'FDA approves Tyvaso inhalation solution', 'Regulatory', 'e06'),
  ];
  const PT = (num, title, assignee, granted, expiry, status, prod, ev) => ({ key: num, num, title, assignee, granted, expiry, status, prod, ev });
  const patents = [
    PT('US 5,153,222', 'Tricyclic benzindene prostacyclin analogues (compound)', 'United Therapeutics', '1992-10-06', '2014-10-06', 'Expired', 'All', 'e11'),
    PT('US 6,765,117', 'Process for preparing benzindene prostaglandins', 'United Therapeutics', '2004-07-20', '2017-10-03', 'Expired', 'All'),
    PT('US 8,747,897', 'Osmotic drug delivery of treprostinil', 'United Therapeutics', '2014-06-10', '2027-05-14', 'Granted', 'Orenitram'),
    PT('US 9,593,066', 'Process to prepare treprostinil', 'United Therapeutics', '2017-03-14', '2028-03-14', 'Granted · asserted', 'All', 'e14'),
    PT('US 9,604,901', 'Process to prepare treprostinil (’901)', 'United Therapeutics', '2017-03-28', '2028-12-15', 'Granted · asserted', 'All'),
    PT('US 10,716,793', 'Treprostinil administration by inhalation', 'United Therapeutics', '2020-07-21', '2027-05-15', 'Invalidated', 'Tyvaso, Tyvaso DPI', 'e22'),
    PT('US 10,898,494', 'Dry powder treprostinil formulations', 'MannKind', '2021-01-26', '2035-05-29', 'Granted', 'Tyvaso DPI'),
    PT('US 11,826,327', 'Treatment of PH associated with interstitial lung disease', 'United Therapeutics', '2023-11-28', '2042-04-15', 'Granted · in litigation', 'Tyvaso, Tyvaso DPI'),
  ];
  const E = (date, title, src, verdict, reason, ev) => ({ key: title.slice(0, 20) + date, date, title, src, verdict, reason, ev });
  const evidence = [
    E('2026-10-05', 'Study Highlights Benefits of Inhaled Treprostinil in IPF', 'rarediseaseadvisor.com', 'Ingest', 'New trial analysis for the asset', 'e37'),
    E('2026-09-30', 'FDA Accepts Inhaled Treprostinil sNDA for IPF: 4 FAQs for Payers', 'ajmc.com', 'Ingest', 'Regulatory filing', 'e36'),
    E('2026-04-28', 'Treprostinil Palmitil Market: Current Analysis and Forecast (2023-2030)', 'univdatos.com', 'Skip', 'Market report about a different molecule'),
    E('2025-02-13', 'Treprostinil: Ngā Whakamahinga, Ngā Pānga Taha…', 'apollohospitals.com', 'Skip', 'Generic reference page'),
    E('2025-01-17', 'Par Pharma recalls seven lots of Treprostinil injection', 'pharmabiz.com', 'Headline', 'Couldn’t fetch; kept the headline', 'e33'),
    E('2024-04-07', 'Inhaled treprostinil cuts mortality among patients of PH-ILD: Study', 'medicaldialogues.in', 'Ingest', 'Clinical evidence', 'e32'),
    E('2023-12-21', 'Liquidia Shares Tank On Patent Court Loss, Rivals May Just Be Getting Started', 'seekingalpha.com', 'Headline', 'Couldn’t fetch; kept the headline', 'e31'),
    E('2023-11-02', 'Comparison of treprostinil and oral sildenafil for PPHN of the newborn', 'frontiersin.org', 'Headline', 'Off-label retrospective study'),
    E('2023-06-02', 'Treprostinil – Side effect(s)', 'medindia.net', 'Skip', 'Generic drug information page'),
    E('2021-01-13', 'Inhaled Treprostinil effective in PH due to ILD: NEJM study', 'medicaldialogues.in', 'Ingest', 'Publication coverage', 'e23'),
  ];
  window.PE_REC = { treprostinil: { clinical: trials, regulatory, publications, conferences, documents, 'company-ir': ir, patents, evidence } };
})();
