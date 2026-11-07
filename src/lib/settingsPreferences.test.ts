import {describe,expect,it} from 'vitest';
import {DEFAULT_AUDIOBOOK_SETTINGS,DEFAULT_MUSIC_SETTINGS,normalizeAudiobookSettings,normalizeDashboardUiPreferences,normalizeInferenceSettings,normalizeMusicSettings} from './settingsPreferences';
describe('RyanAI Settings preference validation',()=>{
 it('enables all modules by default',()=>expect(Object.values(normalizeDashboardUiPreferences(undefined)).every(Boolean)).toBe(true));
 it('preserves valid module choices and ignores malformed values',()=>{const p=normalizeDashboardUiPreferences({calculator:false,admin:'on',unknown:false});expect(p.calculator).toBe(false);expect(p.admin).toBe(true);});
 it('validates voice and speed',()=>{expect(normalizeAudiobookSettings({defaultVoice:'nova',narrationSpeed:1.2})).toEqual({defaultVoice:'nova',narrationSpeed:1.2});expect(normalizeAudiobookSettings({defaultVoice:'bad',narrationSpeed:9})).toEqual(DEFAULT_AUDIOBOOK_SETTINGS);});
 it('accepts only a catalogue model',()=>{expect(normalizeInferenceSettings({preferredModel:'bad'},['a'],'a')).toEqual({preferredModel:'a'});});
});

describe('RyanAI music preference validation',()=>{it('uses safe defaults',()=>expect(normalizeMusicSettings(undefined)).toEqual(DEFAULT_MUSIC_SETTINGS));it('accepts both VLC modes and supported providers',()=>expect(normalizeMusicSettings({defaultProvider:'vlc',vlcMode:'both',volume:45,resumePlayback:false})).toMatchObject({defaultProvider:'vlc',vlcMode:'both',volume:45,resumePlayback:false}));it('clamps volume and rejects unknown provider or mode',()=>expect(normalizeMusicSettings({defaultProvider:'bad',vlcMode:'invalid',volume:150})).toMatchObject({defaultProvider:'vlc',vlcMode:'both',volume:100}));it('normalizes malformed values safely',()=>expect(normalizeMusicSettings({volume:'loud'})).toEqual(DEFAULT_MUSIC_SETTINGS));});
