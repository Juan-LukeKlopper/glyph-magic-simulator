/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { SPELLS_DATABASE } from './spellsData';
import MagicCanvas from './components/MagicCanvas';
import { Spell } from './types';
import { 
  Wand2, 
  BookOpen, 
  Search, 
  Volume2, 
  VolumeX, 
  Info, 
  Sparkles, 
  Flame, 
  Compass, 
  HelpCircle,
  AlertTriangle,
  History
} from 'lucide-react';

export default function App() {
  const [selectedSpell, setSelectedSpell] = useState<Spell | null>(SPELLS_DATABASE[0]);
  const [practiceMode, setPracticeMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('tgg.practiceMode');
    return saved === null ? true : saved === '1';
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('All');
  const [isMuted, setIsMuted] = useState<boolean>(() => localStorage.getItem('tgg.muted') === '1');

  // Persist mode & mute across sessions
  useEffect(() => { localStorage.setItem('tgg.practiceMode', practiceMode ? '1' : '0'); }, [practiceMode]);
  useEffect(() => {
    localStorage.setItem('tgg.muted', isMuted ? '1' : '0');
  }, [isMuted]);

  // Global shortcuts: M mute, T trace mode, S sandbox, / focus search, Esc clear search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack typing in fields, or activate shortcuts while the user is
      // focused on an interactive control (buttons, selects, links).
      if (!target) return;
      const tag = target.tagName;
      const isTypingTarget = tag === 'INPUT' || tag === 'TEXTAREA';
      const isInteractive = tag === 'BUTTON' || tag === 'SELECT' || tag === 'A' || target.isContentEditable;
      if (isTypingTarget) {
        if (e.key === 'Escape') (target as HTMLInputElement).blur();
        return;
      }
      if (isInteractive) return;

      if (e.key === 'm' || e.key === 'M') setIsMuted((v) => !v);
      else if (e.key === 't' || e.key === 'T') setPracticeMode(true);
      else if (e.key === 's' || e.key === 'S') { setPracticeMode(false); setSelectedSpell(null); }
      else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('spell-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  
  // Cast history logger
  const [castHistory, setCastHistory] = useState<Array<{
    id: string;
    name: string;
    score: number;
    timestamp: string;
    status: 'success' | 'fizzle';
    scores?: Record<string, number>;
  }>>([]);
  const [lastCastedResult, setLastCastedResult] = useState<{ name: string; score: number; status: 'success' | 'fizzle' } | null>(null);

  // Filter spells on search queries
  const filteredSpells = useMemo(() => {
    return SPELLS_DATABASE.filter((spell) => {
      const matchesSearch = 
        spell.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        spell.description.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesDifficulty = 
        selectedDifficulty === 'All' || 
        spell.difficulty === selectedDifficulty;

      return matchesSearch && matchesDifficulty;
    });
  }, [searchQuery, selectedDifficulty]);

  const handleSpellRecognized = (spellId: string, accuracy: number, scores?: Record<string, number>) => {
    const spell = SPELLS_DATABASE.find((s) => s.id === spellId);
    if (!spell) return;

    setLastCastedResult({
      name: spell.name,
      score: accuracy,
      status: 'success'
    });

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setCastHistory((prev) => [
      {
        id: Math.random().toString(),
        name: spell.name,
        score: accuracy,
        timestamp: timeString,
        status: 'success',
        // Real per-element resonance from the recognizer; Instant Cast passes none,
        // in which case the spectrograph renders empty rather than fabricated data.
        scores
      },
      ...prev.slice(0, 5) // keep last 6 entries
    ]);
  };

  const handleFizzle = (scores?: Record<string, number>) => {
    setLastCastedResult({
      name: 'Unrecognized Glyph Scribble',
      score: 0,
      status: 'fizzle'
    });

    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let highestElement = 'unknown';
    let highestScore = 0;
    if (scores) {
      Object.entries(scores).forEach(([el, val]) => {
        if (val > highestScore) {
          highestScore = val;
          highestElement = el;
        }
      });
    }

    const name = highestElement !== 'unknown' && highestScore > 0.15
      ? `Faulty ${highestElement.charAt(0).toUpperCase() + highestElement.slice(1)} Attempt`
      : 'Unrecognized Scribble';

    const scorePct = Math.round(highestScore * 100);

    setCastHistory((prev) => [
      {
        id: Math.random().toString(),
        name: name,
        score: scorePct,
        timestamp: timeString,
        status: 'fizzle',
        scores: scores
      },
      ...prev.slice(0, 5) // keep last 6 entries
    ]);
  };

  const getDifficultyBadgeColor = (diff: string) => {
    switch (diff) {
      case 'Novice': return 'bg-amber-950/70 text-amber-300 border border-amber-800/40';
      case 'Apprentice': return 'bg-purple-950/70 text-purple-300 border border-purple-800/35';
      case 'Adept': return 'bg-[#4c1d95]/70 text-[#c084fc] border border-purple-700/40';
      case 'Master': return 'bg-[#831843]/70 text-[#f472b6] border border-pink-700/40';
      case 'Titan-Level': return 'bg-yellow-950/70 text-yellow-200 border border-yellow-700/40 animate-pulse';
      default: return 'bg-[#21142A] text-amber-200/50 border border-amber-900/40';
    }
  };

  return (
    <div className="min-h-screen bg-[#130B1B] text-amber-100/90 antialiased flex flex-col selection:bg-amber-500/30 selection:text-amber-200">
      {/* Skip link: first tab stop, jumps to drawing canvas */}
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-2 focus:rounded-lg focus:bg-amber-950 focus:text-amber-200 focus:border focus:border-amber-500/60 focus:text-xs focus:font-mono"
      >
        Skip to drawing canvas
      </a>
      
      {/* Mystical Alchemical Header */}
      <header className="border-b border-amber-900/30 bg-[#1D1126]/90 backdrop-blur-md px-4 md:px-8 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 via-yellow-500 to-rose-600 flex items-center justify-center shadow-lg shadow-amber-900/20 border border-amber-400/45">
            <Wand2 className="w-5 h-5 text-slate-950 stroke-[2]" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-medium text-lg tracking-wide text-amber-400">
                Titan's Glyph Grimoire
              </h1>
              <span className="text-[10px] bg-amber-950/80 text-amber-300 font-mono px-2.5 py-0.5 rounded-full border border-amber-700/35 font-medium tracking-tight">
                Wild Magic
              </span>
            </div>
            <p className="text-xs text-amber-200/60 font-serif italic tracking-wide">
              An ancient collection of elemental glyphs and synthesized magic from the Boiling Isles
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            aria-label={isMuted ? 'Unmute spell sounds' : 'Mute spell sounds'}
            aria-pressed={isMuted}
            className="p-2 bg-[#2D1C3A] hover:bg-[#3E2750] text-amber-200/80 hover:text-white rounded-lg border border-amber-900/40 hover:border-amber-700/40 transition-all flex items-center gap-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            title={isMuted ? "Unmute Spell Chimes" : "Mute Spell Chimes"}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-rose-400" />
                <span>Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Audio Aura</span>
              </>
            )}
          </button>
          
          <div className="hidden lg:flex items-center gap-1 text-[10px] text-amber-600/70 font-mono uppercase tracking-widest">
            <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-ping" aria-hidden="true" />
            <span>Wild Magic Pulse Strong</span>
          </div>
        </div>
      </header>

      {/* Main Panel Workshop Layout */}
      <main className="flex-grow p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)] lg:h-[calc(100vh-6rem)] gap-6 items-stretch">
        
        {/* Left Column: Codex/Spellbook (5 cols) but rendered SECOND on mobile to avoid scrolling past */}
        <section className="order-2 lg:order-1 lg:col-span-5 lg:row-span-1 lg:min-h-0 flex flex-col gap-4 min-h-0">
          
          {/* Codex Search & Filters */}
          <div className="p-4 bg-[#1C0F25]/90 rounded-2xl border border-amber-900/30 flex flex-col gap-3 shadow-lg shadow-black/20">
            <div className="flex items-center justify-between">
              <span className="font-display font-medium text-[13px] text-amber-400 tracking-wider flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-500" />
                BOILING ISLES SPELLBOOK
              </span>
              <span className="font-mono text-[10px] text-amber-200/40">
                {filteredSpells.length} Transcripts
              </span>
            </div>
            
            {/* Search Input */}
            <div className="relative">
              <input
                id="spell-search-input"
                aria-label="Search spells"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search paths... ( / )"
                className="w-full bg-[#110917] border border-amber-900/30 focus:border-amber-500/50 rounded-lg pl-9 pr-4 py-2 text-xs text-amber-100 placeholder-amber-200/30 font-serif outline-none transition-all"
              />
            </div>

            <div role="group" aria-label="Filter spells by difficulty" className="flex flex-wrap gap-1.5 pt-1">
              {['All', 'Novice', 'Apprentice', 'Adept', 'Master', 'Titan-Level'].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setSelectedDifficulty(level)}
                  aria-pressed={selectedDifficulty === level}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-mono tracking-wide transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                    selectedDifficulty === level
                      ? 'bg-amber-400/20 text-amber-300 border-amber-500/40 font-semibold'
                      : 'bg-[#110917]/80 text-amber-200/50 border-transparent hover:border-amber-900/40 hover:text-amber-200'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Spell Cards List */}
          <div className="flex-grow overflow-y-auto max-h-[550px] lg:max-h-none pr-1 flex flex-col gap-2.5 custom-scrollbar">
            {filteredSpells.length === 0 ? (
              <div className="p-8 text-center bg-[#1C0F25]/40 rounded-xl border border-amber-900/20 flex flex-col items-center justify-center gap-3">
                <Compass className="w-8 h-8 text-amber-600/30 animate-spin" aria-hidden="true" />
                <p className="font-serif italic text-xs text-amber-200/40">
                  No overlapping glyph spells discovered. Check the archives!
                </p>
              </div>
            ) : (
              filteredSpells.map((spell) => {
                const isSelected = selectedSpell?.id === spell.id;
                return (
                  <div
                    key={spell.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${spell.name}, ${spell.difficulty} difficulty`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedSpell(spell);
                      }
                    }}
                    onClick={() => setSelectedSpell(spell)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer select-none text-left flex flex-col gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                      isSelected
                        ? 'bg-[#291838]/95 border-amber-500 shadow-xl shadow-amber-950/10 animate-pulse-subtle'
                        : 'bg-[#1C0F25]/75 border-[#2E183B] hover:border-amber-900/40 hover:bg-[#21122C]'
                    }`}
                  >
                    {/* Spell Card Line Title */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2.5 h-2.5 rounded-full" 
                          style={{ 
                            backgroundColor: spell.color,
                            boxShadow: `0 0 10px ${spell.shadowColor}`
                          }} 
                        />
                        <h3 className={`font-display font-medium text-sm ${isSelected ? 'text-amber-400 font-semibold' : 'text-amber-100/90'}`}>
                          {spell.name}
                        </h3>
                      </div>
                      <span className={`px-2 py-0.5 rounded font-mono text-[9px] uppercase font-semibold ${getDifficultyBadgeColor(spell.difficulty)}`}>
                        {spell.difficulty}
                      </span>
                    </div>

                    <p className="text-xs text-amber-200/70 font-serif leading-relaxed line-clamp-2">
                      {spell.description}
                    </p>

                    {/* Meta Alchemical Recipe if Combinatory */}
                    {spell.recipe && (
                      <div className="bg-[#110917]/70 border border-amber-900/20 rounded p-2 text-[10px] font-serif leading-relaxed flex items-start gap-2">
                        <span className="text-amber-400 font-semibold flex-shrink-0">Combination:</span>
                        <span className="text-amber-200/60 line-clamp-1 italic">{spell.recipe.layout}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right Column: Interaction Arena (7 cols) but rendered FIRST on mobile to bypass scrolling */}
        <section id="workspace" className="order-1 lg:order-2 lg:col-span-7 lg:row-span-1 lg:min-h-0 flex flex-col gap-5 min-h-0">

          {/* Spell details, info panel */}
          {selectedSpell && (
            <div 
              className="p-4 rounded-xl border border-amber-950 bg-[#1D1126]/90 backdrop-blur-sm shadow-md text-left transition-all duration-300"
              style={{ borderLeft: `4px solid ${selectedSpell.color}` }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-mono tracking-widest text-amber-400 uppercase font-bold flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Boiling Isles Archives
                </span>
                <span className="text-[10px] font-mono text-amber-200/40">
                  {selectedSpell.type === 'primitive' ? 'Foundational Glyph' : 'Synthesized Spell'}
                </span>
              </div>
              <h2 className="text-lg font-display font-medium text-amber-300 mt-1">
                {selectedSpell.name}
              </h2>
              <p className="text-xs text-amber-100/85 leading-relaxed mt-2 italic font-serif border-l-2 border-amber-700 pl-2">
                &ldquo;{selectedSpell.lore}&rdquo;
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-amber-900/20 text-[11px] font-serif">
                <div>
                  <span className="text-amber-400/60 font-semibold">Chronicles of Discovery:</span>
                  <p className="text-amber-200/80 mt-0.5 leading-relaxed">{selectedSpell.discovery}</p>
                </div>
                <div>
                  <span className="text-amber-400/60 font-semibold">Active Catalyst Response:</span>
                  <p className="text-amber-200/80 mt-0.5 leading-relaxed">{selectedSpell.visualDescription}</p>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Workspace Area */}
          <div className="flex-grow lg:min-h-0 flex flex-col gap-4">
            
            {/* Mode selection Bar */}
            <div className="flex items-center justify-between bg-[#1C0F25] p-2 rounded-xl border border-amber-900/30 shadow-inner">
              <div className="flex gap-1.5">
                <button
                  id="mode-trace-btn"
                  type="button"
                  onClick={() => setPracticeMode(true)}
                  aria-pressed={practiceMode}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono tracking-wide transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                    practiceMode
                      ? 'bg-amber-950/85 border border-amber-800/40 text-amber-300'
                      : 'bg-transparent text-amber-200/40 hover:text-amber-200 border border-transparent'
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Trace Inscription
                </button>
                <button
                  id="mode-sandbox-btn"
                  type="button"
                  onClick={() => {
                    setPracticeMode(false);
                    setSelectedSpell(null); // Clear active tracer phantom
                  }}
                  aria-pressed={!practiceMode}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono tracking-wide transition-all flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${
                    !practiceMode
                      ? 'bg-amber-950/85 border border-amber-800/40 text-amber-300'
                      : 'bg-transparent text-amber-200/40 hover:text-amber-200 border border-transparent'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  Sandbox Free-draw
                </button>
              </div>

              {selectedSpell && practiceMode && (
                <div className="flex items-center gap-2 pr-1.5">
                  <span className="text-[10px] text-amber-200/40 font-mono">Target:</span>
                  <span 
                    className="text-[10px] font-mono uppercase bg-[#110917] px-2 py-0.5 rounded border text-amber-200"
                    style={{ borderColor: selectedSpell.color }}
                  >
                    {selectedSpell.name.split(' ')[0]}
                  </span>
                </div>
              )}
            </div>

            {/* Active Drawing Canvas Frame */}
            <MagicCanvas
              currentSpell={selectedSpell}
              practiceMode={practiceMode}
              onSpellRecognized={handleSpellRecognized}
              onFizzle={handleFizzle}
              isMuted={isMuted}
            />

            {/* Live Compiler logs output lines */}
            <div role="status" aria-live="polite" aria-atomic="true" className="p-3 bg-[#1C0F25] border border-amber-900/30 rounded-xl flex items-center justify-between text-left gap-3 relative overflow-hidden group shadow-lg">
              <div className="flex items-center gap-2.5 max-w-full">
                <div aria-hidden="true" className="w-8 h-8 rounded-lg bg-[#110917] border border-amber-900/40 flex items-center justify-center flex-shrink-0 animate-pulse">
                  {lastCastedResult?.status === 'success' ? (
                    <Sparkles className="w-4 h-4 text-amber-400" />
                  ) : lastCastedResult?.status === 'fizzle' ? (
                    <AlertTriangle className="w-4 h-4 text-rose-500" />
                  ) : (
                    <HelpCircle className="w-4 h-4 text-amber-600/60" />
                  )}
                </div>
                <div className="min-w-0 font-serif">
                  <span className="font-mono text-[9px] text-amber-500/60 tracking-wider block uppercase">Arcane Inscription Response:</span>
                  <p className="font-serif text-xs text-amber-100 truncate font-semibold">
                    {lastCastedResult ? (
                      lastCastedResult.status === 'success' ? (
                        <>
                          Successfully conjured {lastCastedResult.name}
                          {lastCastedResult.score > 0 && ` with ${lastCastedResult.score}% match`}.
                        </>
                      ) : (
                        <span className="text-rose-400 font-serif italic">{lastCastedResult.name} did not resolve to a spell.</span>
                      )
                    ) : (
                      "The magical parchment is blank. Trace or scribble glyphs to conjure..."
                    )}
                  </p>
                </div>
              </div>

              {lastCastedResult && lastCastedResult.score > 0 && (
                <div className="text-right flex-shrink-0 bg-[#110917] border border-amber-900/30 px-2.5 py-1 rounded font-mono">
                  <span className="text-[10px] text-amber-600/60 block">Similarity Ratio:</span>
                  <div className="text-[11px] font-bold text-amber-400">{lastCastedResult.score}% Match</div>
                </div>
              )}
            </div>

            {/* In-world explanation instructions card */}
            <div className="bg-[#1C0F25]/40 rounded-xl border border-amber-900/20 p-3.5 text-left text-xs text-amber-200/60 flex items-start gap-2.5 shadow-inner">
              <Info className="w-4 h-4 text-amber-500/60 flex-shrink-0 mt-0.5" />
              <div className="leading-relaxed font-serif">
                <strong className="text-amber-300 font-serif">Witchcraft Mechanics:</strong> Hold drag to draw magical golden ink lines on the obsidian pad. Click to shatter active Ice structures, and drag floating Light spheres or Teleportation portal boundaries around to warp gravity!
              </div>
            </div>

            {/* History Logger drawer */}
            {castHistory.length > 0 && (
              <div className="p-4 bg-[#1C0F25]/60 border border-amber-900/35 rounded-2xl flex flex-col gap-3.5 shadow-inner">
                <div className="flex items-center justify-between text-amber-500/60 font-mono text-[10px] tracking-wider uppercase">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <History className="w-3.5 h-3.5 text-amber-500 animate-spin-slow" />
                    Glyph Resonance Chronicles
                  </span>
                  <button 
                    type="button"
                    onClick={() => setCastHistory([])} 
                    aria-label="Clear cast history"
                    className="hover:text-rose-400 transition-all flex items-center gap-1 cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:rounded"
                  >
                    Wipe Inscription Log
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {castHistory.map((item) => {
                    const itemScores = item.scores || { light: 0, ice: 0, plant: 0, fire: 0, circle: 0 };
                    
                    const getPercent = (v?: number) => {
                      if (v === undefined) return 0;
                      return Math.max(0, Math.min(100, Math.round(v <= 1 ? v * 100 : v)));
                    };

                    const lightPct = getPercent(itemScores.light);
                    const icePct = getPercent(itemScores.ice);
                    const plantPct = getPercent(itemScores.plant);
                    const firePct = getPercent(itemScores.fire);
                    const circlePct = getPercent(itemScores.circle);

                    const isSuccess = item.status === 'success';

                    return (
                      <div 
                        key={item.id} 
                        className={`p-3 bg-[#110917]/90 border rounded-xl flex flex-col justify-between shadow-lg relative overflow-hidden transition-all duration-200 hover:border-amber-500/30 ${
                          isSuccess ? 'border-amber-900/35' : 'border-rose-900'
                        }`}
                      >
                        {/* Glow effect matching success state */}
                        <div 
                          className={`absolute top-0 right-0 w-24 h-24 rounded-full filter blur-[24px] pointer-events-none opacity-[0.06] ${
                            isSuccess ? 'bg-amber-400' : 'bg-rose-500'
                          }`}
                        />

                        {/* Top Metadata Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-left font-serif">
                            <span className={`font-display font-medium text-xs block ${
                              isSuccess ? 'text-amber-300' : 'text-rose-400 font-semibold'
                            }`}>
                              {item.name}
                            </span>
                            <span className="text-[10px] text-amber-200/45 font-mono">
                              {item.timestamp} • {isSuccess ? 'Successfully Cast' : 'Failed Attempt'}
                            </span>
                          </div>
                          
                          <div className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            isSuccess 
                              ? 'bg-amber-900 text-amber-300 border border-amber-800/40'
                              : 'bg-rose-900 text-rose-300 border border-rose-900/30'
                          }`}>
                            {item.score}% Match
                          </div>
                        </div>

                        {/* Detailed 5-Glyph Resonance Spectrograph Grid */}
                        <div className="grid grid-cols-5 gap-1 pt-2.5 mt-2 border-t border-amber-900/10">
                          
                          {/* Light */}
                          <div className="flex flex-col gap-0.5 items-center bg-yellow-950/10 p-1 rounded border border-yellow-900/10">
                            <span className="text-yellow-400/90 font-mono text-[8px] tracking-tighter uppercase font-medium">☀️ Sun</span>
                            <span className="font-mono font-bold text-yellow-300 text-[9px]">{lightPct}%</span>
                            <div className="w-full h-0.5 bg-yellow-950/60 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full bg-gradient-to-r from-yellow-500 to-yellow-300 relative" style={{ width: `${lightPct}%` }} />
                            </div>
                          </div>

                          {/* Ice */}
                          <div className="flex flex-col gap-0.5 items-center bg-cyan-950/15 p-1 rounded border border-cyan-900/10">
                            <span className="text-cyan-400/90 font-mono text-[8px] tracking-tighter uppercase font-medium">❄️ Cold</span>
                            <span className="font-mono font-bold text-cyan-300 text-[9px]">{icePct}%</span>
                            <div className="w-full h-0.5 bg-cyan-950/60 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full bg-gradient-to-r from-cyan-500 to-cyan-300 relative" style={{ width: `${icePct}%` }} />
                            </div>
                          </div>

                          {/* Plant */}
                          <div className="flex flex-col gap-0.5 items-center bg-emerald-950/10 p-1 rounded border border-emerald-900/10">
                            <span className="text-emerald-400/90 font-mono text-[8px] tracking-tighter uppercase font-medium">🌿 Wild</span>
                            <span className="font-mono font-bold text-emerald-300 text-[9px]">{plantPct}%</span>
                            <div className="w-full h-0.5 bg-emerald-950/60 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 relative" style={{ width: `${plantPct}%` }} />
                            </div>
                          </div>

                          {/* Fire */}
                          <div className="flex flex-col gap-0.5 items-center bg-rose-950/10 p-1 rounded border border-rose-900/10">
                            <span className="text-rose-400/90 font-mono text-[8px] tracking-tighter uppercase font-medium">🔥 Heat</span>
                            <span className="font-mono font-bold text-rose-300 text-[9px]">{firePct}%</span>
                            <div className="w-full h-0.5 bg-rose-950/60 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full bg-gradient-to-r from-rose-500 to-rose-300 relative" style={{ width: `${firePct}%` }} />
                            </div>
                          </div>

                          {/* Circle */}
                          <div className="flex flex-col gap-0.5 items-center bg-amber-950/10 p-1 rounded border border-amber-900/10">
                            <span className="text-amber-400 font-mono text-[8px] tracking-tighter uppercase font-medium">🛡️ Ring</span>
                            <span className="font-mono font-bold text-amber-300 text-[9px]">{circlePct}%</span>
                            <div className="w-full h-0.5 bg-amber-950/60 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full bg-gradient-to-r from-amber-500 to-amber-300 relative" style={{ width: `${circlePct}%` }} />
                            </div>
                          </div>
                          
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </section>

      </main>

      {/* Humble Footer */}
      <footer className="border-t border-amber-900/30 bg-[#140B1A]/80 px-4 py-3 text-center text-[10px] font-mono text-amber-200/30 mt-auto flex flex-col sm:flex-row items-center justify-between gap-2">
        <span>Wild Magic Circle Inscriber © Luz Noceda Notebooks & Philip Wittebane Archives</span>
        <span>A tribute to Boiling Isles glyph studies</span>
      </footer>

    </div>
  );
}
