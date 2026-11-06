export const DASHBOARD_UI_OPTIONS = [
 { id:'dashboard',label:'Dashboard',description:'Show the system dashboard and workspace shortcuts.' },
 { id:'pa',label:'Personal Assistant',description:'Show the Personal Assistant workspace.' },
 { id:'operator',label:'Operator Console',description:'Show durable task execution and progress.' },
 { id:'operations',label:'Operations Center',description:'Show operations and review tools.',access:'admin' },
 { id:'admin',label:'Admin Console',description:'Show administrative controls.',access:'admin' },
 { id:'quant',label:'Quant Lab',description:'Show isolated research and paper-trading tools.' },
 { id:'trading',label:'Trading Terminal',description:'Show the trading workspace.' },
 { id:'cockpit',label:'Command Cockpit',description:'Show model and platform health views.' },
 { id:'studio',label:'RyanAI Studio',description:'Show the development studio.',access:'admin' },
 { id:'comms',label:'RyanAI Communications',description:'Show owner-authorised communications.',access:'owner' },
 { id:'workspace',label:'Reasoning Workspace',description:'Show chat, memory and workspace tools.' },
 { id:'calculator',label:'Calculator',description:'Enable or disable the calculator UI.' },
 { id:'audiobook',label:'Audiobook Studio',description:'Enable or disable the audiobook workspace.' },
 { id:'inferenceConsole',label:'Inference Console',description:'Enable or disable the inference console in Workspace.' },
] as const;
export type DashboardUiId=(typeof DASHBOARD_UI_OPTIONS)[number]['id'];
export type DashboardUiPreferences=Record<DashboardUiId,boolean>;
export const AUDIOBOOK_VOICES=['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer','verse'] as const;
export type AudiobookVoice=(typeof AUDIOBOOK_VOICES)[number];
export const AUDIOBOOK_SPEEDS=[0.8,0.9,1,1.1,1.2] as const;
export interface AudiobookSettings { defaultVoice:AudiobookVoice; narrationSpeed:(typeof AUDIOBOOK_SPEEDS)[number]; }
export const DEFAULT_AUDIOBOOK_SETTINGS:AudiobookSettings={defaultVoice:'coral',narrationSpeed:1};
export function normalizeDashboardUiPreferences(value:unknown):DashboardUiPreferences {
 const result=Object.fromEntries(DASHBOARD_UI_OPTIONS.map(({id})=>[id,true])) as DashboardUiPreferences;
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 const input=value as Record<string,unknown>;
 for(const {id} of DASHBOARD_UI_OPTIONS)if(typeof input[id]==='boolean')result[id]=input[id];
 return result;
}
export function normalizeAudiobookSettings(value:unknown):AudiobookSettings {
 if(!value||typeof value!=='object'||Array.isArray(value))return {...DEFAULT_AUDIOBOOK_SETTINGS};
 const input=value as Record<string,unknown>;
 return {
  defaultVoice:AUDIOBOOK_VOICES.includes(input.defaultVoice as AudiobookVoice)?input.defaultVoice as AudiobookVoice:DEFAULT_AUDIOBOOK_SETTINGS.defaultVoice,
  narrationSpeed:AUDIOBOOK_SPEEDS.includes(input.narrationSpeed as AudiobookSettings['narrationSpeed'])?input.narrationSpeed as AudiobookSettings['narrationSpeed']:DEFAULT_AUDIOBOOK_SETTINGS.narrationSpeed,
 };
}
export function normalizeInferenceSettings(value:unknown,validModels:readonly string[],fallbackModel:string):{preferredModel:string} {
 if(!value||typeof value!=='object'||Array.isArray(value))return {preferredModel:fallbackModel};
 const candidate=(value as Record<string,unknown>).preferredModel;
 return {preferredModel:typeof candidate==='string'&&validModels.includes(candidate)?candidate:fallbackModel};
}
