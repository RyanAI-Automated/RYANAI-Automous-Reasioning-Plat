export type SouthAfricanBankCategory = 'commercial' | 'foreign_branch' | 'cooperative' | 'mutual';

export type SouthAfricanBank = {
  id: string;
  name: string;
  category: SouthAfricanBankCategory;
  country?: string;
};

export const SOUTH_AFRICAN_BANKS: SouthAfricanBank[] = [
  { id: 'absa', name: 'ABSA Bank Limited', category: 'commercial' },
  { id: 'access-bank', name: 'Access Bank', category: 'commercial' },
  { id: 'african-bank', name: 'African Bank Limited', category: 'commercial' },
  { id: 'albaraka', name: 'Albaraka Bank', category: 'commercial' },
  { id: 'bidvest', name: 'Bidvest Bank Limited', category: 'commercial' },
  { id: 'capitec', name: 'Capitec Bank Limited', category: 'commercial' },
  { id: 'discovery', name: 'Discovery Bank Limited', category: 'commercial' },
  { id: 'firstrand', name: 'FirstRand Bank Limited', category: 'commercial' },
  { id: 'investec', name: 'Investec Bank Limited', category: 'commercial' },
  { id: 'nedbank', name: 'Nedbank Limited', category: 'commercial' },
  { id: 'om-bank', name: 'OM Bank Limited', category: 'commercial' },
  { id: 'sasfin', name: 'Sasfin Bank Limited', category: 'commercial' },
  { id: 'standard-bank', name: 'Standard Bank', category: 'commercial' },
  { id: 'tymebank', name: 'TymeBank Limited', category: 'commercial' },
  { id: 'bank-of-china', name: 'Bank of China', category: 'foreign_branch', country: 'China' },
  { id: 'bank-of-taiwan', name: 'Bank of Taiwan', category: 'foreign_branch', country: 'Taiwan' },
  { id: 'bnpparibas', name: 'BNP Paribas S.A.', category: 'foreign_branch', country: 'France' },
  { id: 'bank-of-communications', name: 'Bank of Communications Co. Ltd', category: 'foreign_branch', country: 'China' },
  { id: 'china-construction-bank', name: 'China Construction Bank Corporation', category: 'foreign_branch', country: 'China' },
  { id: 'citibank', name: 'Citibank N.A.', category: 'foreign_branch', country: 'United States' },
  { id: 'deutsche-bank', name: 'Deutsche Bank', category: 'foreign_branch', country: 'Germany' },
  { id: 'goldman-sachs', name: 'Goldman Sachs', category: 'foreign_branch', country: 'United States' },
  { id: 'hsbc', name: 'HSBC', category: 'foreign_branch', country: 'United Kingdom' },
  { id: 'jp-morgan', name: 'JP Morgan Chase Bank', category: 'foreign_branch', country: 'United States' },
  { id: 'standard-chartered', name: 'Standard Chartered Bank', category: 'foreign_branch', country: 'United Kingdom' },
  { id: 'state-bank-india', name: 'State Bank of India', category: 'foreign_branch', country: 'India' },
  { id: 'ditsobotla', name: 'Ditsobotla Primary Savings and Credit Co-operative Bank', category: 'cooperative' },
  { id: 'ksk', name: 'KSK Koöperatiewe Bank Beperk', category: 'cooperative' },
  { id: 'osk', name: 'OSK', category: 'cooperative' },
  { id: 'ziphakamise', name: 'Ziphakamise', category: 'cooperative' },
  { id: 'gig', name: 'GIG', category: 'cooperative' },
  { id: 'bank-zero', name: 'Bank Zero Mutual Bank', category: 'mutual' },
  { id: 'finbond', name: 'Finbond Mutual Bank', category: 'mutual' },
  { id: 'gbs', name: 'GBS Mutual Bank', category: 'mutual' },
];

export const SOUTH_AFRICAN_BANK_SOURCE = 'South African Reserve Bank / Corporation for Deposit Insurance (CODI) member-bank list, July 2026 update, supplemented by the SARB Register of Co-operative Banks.';

export const BANK_CATEGORY_LABELS: Record<SouthAfricanBankCategory, string> = {
  commercial: 'Commercial banks',
  foreign_branch: 'Branches of foreign banks',
  cooperative: 'Co-operative banks',
  mutual: 'Mutual banks',
};
