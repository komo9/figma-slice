/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Trophy, MousePointer2, Layers, Square, Circle, Star, Hexagon, Component, Bug, Zap, ChevronLeft } from 'lucide-react';
import confetti from 'canvas-confetti';

// --- Types ---

interface Point {
  x: number;
  y: number;
  time: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
}

interface FigmaLayer {
  id: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  type: 'rect' | 'circle' | 'star' | 'poly' | 'instance' | 'bug';
  isSliced: boolean;
  isBomb: boolean;
  rotation: number;
  rotationSpeed: number;
  selectionOpacity: number;
}

// --- Constants ---

const GRAVITY = 0.1;
const LAYER_RADIUS = 35;
const BUG_RADIUS = 40;
const INITIAL_LIVES = 3;
const TRAIL_MAX_AGE = 250; // ms
const SPAWN_INTERVAL = 2500; // ms between waves
const TOP_NAV_HEIGHT = 48;

const FIGMA_COLORS = [
  '#F24E1E', // Red
  '#FF7262', // Orange
  '#A259FF', // Purple
  '#1ABCFE', // Blue
  '#0ACF83', // Green
];

const FIGMA_PUNS = [
  "Your library is crying. Re-link your instances immediately!",
  "You've lost your master. Now you're just a lonely instance.",
  "Component sliced. Your design just lost its inheritance.",
  "You detached the main component. Who does that?!",
  "The design system police are on their way.",
  "Your library is crying right now."
];

const LAYER_TYPES = [
  { type: 'rect', icon: Square, name: 'Rectangle' },
  { type: 'circle', icon: Circle, name: 'Ellipse' },
  { type: 'star', icon: Star, name: 'Star' },
  { type: 'poly', icon: Hexagon, name: 'Polygon' },
  { type: 'instance', icon: Component, name: 'Instance' },
];

// --- Audio Helper ---

class SoundManager {
  private ctx: AudioContext | null = null;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  playSwoosh() {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.03, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playSlice() {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    // High frequency "snap"
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.1);
    gain1.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start();
    osc1.stop(this.ctx.currentTime + 0.1);

    // Lower "thud"
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(200, this.ctx.currentTime);
    gain2.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start();
    osc2.stop(this.ctx.currentTime + 0.15);
  }

  playCombo() {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);
      gain.gain.setValueAtTime(0.1, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.2);
    });
  }

  playBug() {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }
}

const sounds = new SoundManager();

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [pun, setPun] = useState("");
  const [combo, setCombo] = useState<{ text: string; x: number; y: number; id: number } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(typeof window !== 'undefined' && window.innerWidth < 768 ? 0 : 240);

  // Game references
  const layersRef = useRef<FigmaLayer[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const trailRef = useRef<Point[]>([]);
  const isMouseDown = useRef(false);
  const lastMousePos = useRef<Point | null>(null);
  const requestRef = useRef<number>(0);
  const nextId = useRef(0);
  const lastSpawnTime = useRef(0);
  const currentSwipeSlices = useRef<number>(0);

  useEffect(() => {
    const saved = localStorage.getItem('figma-slice-highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  useEffect(() => {
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('figma-slice-highscore', score.toString());
    }
  }, [score, highScore]);

  const startGame = () => {
    sounds.init();
    setGameState('playing');
    setScore(0);
    setLives(INITIAL_LIVES);
    layersRef.current = [];
    particlesRef.current = [];
    trailRef.current = [];
  };

  const spawnLayer = (width: number, height: number) => {
    if (layersRef.current.length >= 10) return;

    const isMainComp = Math.random() < 0.12;
    const layerType = LAYER_TYPES[Math.floor(Math.random() * LAYER_TYPES.length)];
    const color = FIGMA_COLORS[Math.floor(Math.random() * FIGMA_COLORS.length)];
    
    // Working area bounds
    const minX = sidebarWidth + 50;
    const maxX = width - sidebarWidth - 50;
    const workingWidth = maxX - minX;

    // Spawn from bottom, within the central working area
    const x = Math.random() * workingWidth + minX;
    const y = height + 50;
    
    // Aim towards the top, with more horizontal spread to fill the screen
    const targetX = width / 2 + (Math.random() - 0.5) * (workingWidth * 0.8); 
    const vx = (targetX - x) / (100 + Math.random() * 50); 
    
    // Calculate vy to peak below the top nav
    // peakY = y - (vy^2 / 2*GRAVITY)
    // We want peakY > TOP_NAV_HEIGHT + 55 (even tighter margin for "higher" feel)
    const maxPeakHeight = height - (TOP_NAV_HEIGHT + 55);
    const maxVy = Math.sqrt(2 * GRAVITY * maxPeakHeight);
    const vy = -(Math.random() * (maxVy * 0.1) + (maxVy * 0.85)); // Even higher vertical push

    layersRef.current.push({
      id: nextId.current++,
      name: isMainComp ? 'Main Component' : `${layerType.name} ${nextId.current}`,
      x,
      y,
      vx,
      vy,
      radius: isMainComp ? BUG_RADIUS : LAYER_RADIUS,
      color: isMainComp ? '#A259FF' : color,
      type: isMainComp ? 'bug' : layerType.type as any,
      isSliced: false,
      isBomb: isMainComp,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.08, // Slower rotation
      selectionOpacity: 0,
    });
  };

  const createParticles = (x: number, y: number, color: string) => {
    for (let i = 0; i < 12; i++) {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        color,
        size: Math.random() * 3 + 2,
        life: 1.0,
      });
    }
  };

  const checkSlice = (p1: Point, p2: Point) => {
    const layers = layersRef.current;
    let slicedThisFrame = 0;

    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (l.isSliced) continue;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const t = ((l.x - p1.x) * dx + (l.y - p1.y) * dy) / (dx * dx + dy * dy);
      const closestX = p1.x + Math.max(0, Math.min(1, t)) * dx;
      const closestY = p1.y + Math.max(0, Math.min(1, t)) * dy;
      const dist = Math.sqrt((l.x - closestX) ** 2 + (l.y - closestY) ** 2);

      if (dist < l.radius) {
        l.isSliced = true;
        if (l.isBomb) {
          sounds.playBug();
          setLives(0);
          setPun(FIGMA_PUNS[Math.floor(Math.random() * FIGMA_PUNS.length)]);
          setGameState('gameover');
          confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.6 },
            colors: ['#A259FF', '#F24E1E', '#FFFFFF']
          });
        } else {
          sounds.playSlice();
          setScore(s => s + 1);
          createParticles(l.x, l.y, l.color);
          slicedThisFrame++;
          currentSwipeSlices.current++;
        }
      }
    }

    if (currentSwipeSlices.current >= 3 && slicedThisFrame > 0) {
      const messages = [
        "Auto-Layout Master!",
        "Component King!",
        "Design System God!",
        "Pixel Perfect!",
        "Instance Wizard!"
      ];
      const msgIndex = Math.min(currentSwipeSlices.current - 3, messages.length - 1);
      const msg = messages[msgIndex];
      
      setCombo({
        text: `${currentSwipeSlices.current}x ${msg}`,
        x: p2.x,
        y: p2.y,
        id: Date.now()
      });
      sounds.playCombo();
      
      // Clear combo message after 1.2s
      setTimeout(() => setCombo(null), 1200);
    }
  };

  const drawLayer = (ctx: CanvasRenderingContext2D, l: FigmaLayer) => {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.rotation);
    
    const size = l.radius * 1.8;

    // Draw Selection Box if sliced or hovered (simulated)
    if (l.selectionOpacity > 0) {
      ctx.strokeStyle = '#18A0FB';
      ctx.lineWidth = 1;
      ctx.globalAlpha = l.selectionOpacity;
      ctx.strokeRect(-size/2 - 4, -size/2 - 4, size + 8, size + 8);
      
      // Handles
      const hSize = 6;
      ctx.fillStyle = '#fff';
      ctx.strokeRect(-size/2 - 4 - hSize/2, -size/2 - 4 - hSize/2, hSize, hSize);
      ctx.fillRect(-size/2 - 4 - hSize/2, -size/2 - 4 - hSize/2, hSize, hSize);
      
      ctx.strokeRect(size/2 + 4 - hSize/2, -size/2 - 4 - hSize/2, hSize, hSize);
      ctx.fillRect(size/2 + 4 - hSize/2, -size/2 - 4 - hSize/2, hSize, hSize);
      
      ctx.strokeRect(-size/2 - 4 - hSize/2, size/2 + 4 - hSize/2, hSize, hSize);
      ctx.fillRect(-size/2 - 4 - hSize/2, size/2 + 4 - hSize/2, hSize, hSize);
      
      ctx.strokeRect(size/2 + 4 - hSize/2, size/2 + 4 - hSize/2, hSize, hSize);
      ctx.fillRect(size/2 + 4 - hSize/2, size/2 + 4 - hSize/2, hSize, hSize);
      ctx.globalAlpha = 1.0;
    }

    ctx.fillStyle = l.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;

    if (l.type === 'rect') {
      ctx.beginPath();
      ctx.roundRect(-size/2, -size/2, size, size, 4);
      ctx.fill();
      ctx.stroke();
    } else if (l.type === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, size/2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (l.type === 'instance') {
      // Single diamond for instance
      ctx.beginPath();
      ctx.moveTo(0, -size/2);
      ctx.lineTo(size/2, 0);
      ctx.lineTo(0, size/2);
      ctx.lineTo(-size/2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (l.type === 'star') {
      const spikes = 5;
      const outerRadius = size/2;
      const innerRadius = size/4;
      let rot = Math.PI / 2 * 3;
      let x = 0;
      let y = 0;
      const step = Math.PI / spikes;

      ctx.beginPath();
      ctx.moveTo(0, -outerRadius);
      for (let i = 0; i < spikes; i++) {
        x = Math.cos(rot) * outerRadius;
        y = Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = Math.cos(rot) * innerRadius;
        y = Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
      }
      ctx.lineTo(0, -outerRadius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (l.type === 'poly') {
      const sides = 6;
      ctx.beginPath();
      ctx.moveTo(size/2 * Math.cos(0), size/2 * Math.sin(0));
      for (let i = 1; i <= sides; i++) {
        ctx.lineTo(size/2 * Math.cos(i * 2 * Math.PI / sides), size/2 * Math.sin(i * 2 * Math.PI / sides));
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (l.type === 'bug') {
      // Main Component Symbol (4 diamonds)
      const dSize = size / 2.2;
      const offset = size / 4;
      
      ctx.fillStyle = '#A259FF'; // Figma Purple
      
      const drawDiamond = (ox: number, oy: number) => {
        ctx.beginPath();
        ctx.moveTo(ox, oy - dSize/2);
        ctx.lineTo(ox + dSize/2, oy);
        ctx.lineTo(ox, oy + dSize/2);
        ctx.lineTo(ox - dSize/2, oy);
        ctx.closePath();
        ctx.fill();
      };

      drawDiamond(0, -offset); // Top
      drawDiamond(offset, 0);  // Right
      drawDiamond(0, offset);  // Bottom
      drawDiamond(-offset, 0); // Left
    }

    ctx.restore();
  };

  const update = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const now = Date.now();

    ctx.clearRect(0, 0, width, height);

    // Clip to working area (between sidebars and below top nav)
    ctx.save();
    ctx.beginPath();
    ctx.rect(sidebarWidth, TOP_NAV_HEIGHT, width - sidebarWidth * 2, height - TOP_NAV_HEIGHT);
    ctx.clip();

    if (gameState === 'playing') {
      // Gradual difficulty increase based on score
      const difficulty = Math.min(1, score / 150); // Maxes out at 150 score
      const currentSpawnInterval = Math.max(800, SPAWN_INTERVAL - (difficulty * 1700)); // Interval drops from 2.5s to 0.8s
      const maxShapesOnScreen = score > 50 ? (score > 100 ? 12 : 10) : 8; // Max shapes increase from 8 to 12
      
      const timeSinceLastSpawn = now - lastSpawnTime.current;
      if (timeSinceLastSpawn > currentSpawnInterval && layersRef.current.length < maxShapesOnScreen) {
        const maxWaveSize = score > 30 ? (score > 80 ? 8 : 6) : 5;
        const count = Math.floor(Math.random() * maxWaveSize) + 2; // Minimum 2 shapes per wave
        
        for (let i = 0; i < count; i++) {
          if (layersRef.current.length + i < maxShapesOnScreen) {
            setTimeout(() => spawnLayer(width, height), i * 250);
          }
        }
        lastSpawnTime.current = now;
      }

      layersRef.current = layersRef.current.filter(l => {
        l.x += l.vx;
        l.y += l.vy;
        l.vy += GRAVITY;
        l.rotation += l.rotationSpeed;

        // Selection fade out
        if (l.isSliced) {
          l.selectionOpacity = Math.max(0, l.selectionOpacity - 0.1);
        } else {
          // Pulse selection if near cursor
          if (lastMousePos.current) {
            const d = Math.sqrt((l.x - lastMousePos.current.x)**2 + (l.y - lastMousePos.current.y)**2);
            if (d < l.radius * 2) {
              l.selectionOpacity = Math.min(0.8, l.selectionOpacity + 0.2);
            } else {
              l.selectionOpacity = Math.max(0, l.selectionOpacity - 0.1);
            }
          }
        }

        if (l.y > height + 100 && !l.isSliced && !l.isBomb) {
          setLives(lv => {
            const next = lv - 1;
            if (next <= 0) setGameState('gameover');
            return next;
          });
          return false;
        }
        return l.y < height + 200;
      });

      particlesRef.current = particlesRef.current.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += GRAVITY * 0.4;
        p.life -= 0.025;
        return p.life > 0;
      });

      trailRef.current = trailRef.current.filter(p => now - p.time < TRAIL_MAX_AGE);
    }

    // Draw Particles
    particlesRef.current.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Draw Layers
    layersRef.current.forEach(l => {
      if (!l.isSliced) drawLayer(ctx, l);
    });

    // Draw Trail (Figma Vector Path Style)
    if (trailRef.current.length > 1) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Draw the path line
      ctx.beginPath();
      ctx.strokeStyle = '#18A0FB'; // Figma Blue
      ctx.lineWidth = 2;
      
      const pStart = trailRef.current[0];
      ctx.moveTo(pStart.x, pStart.y);
      
      for (let i = 1; i < trailRef.current.length; i++) {
        const p = trailRef.current[i];
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Draw "Anchor Points" at segments
      trailRef.current.forEach((p, i) => {
        if (i % 3 === 0 || i === trailRef.current.length - 1) {
          const age = now - p.time;
          const opacity = 1 - age / TRAIL_MAX_AGE;
          ctx.globalAlpha = opacity;
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#18A0FB';
          ctx.lineWidth = 1;
          ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
          ctx.strokeRect(p.x - 3, p.y - 3, 6, 6);
        }
      });
      ctx.globalAlpha = 1.0;
    }

    ctx.restore(); // Restore from the working area clip

    requestRef.current = requestAnimationFrame(update);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      setSidebarWidth(window.innerWidth < 768 ? 0 : 240);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    requestRef.current = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, score]);

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const now = Date.now();

    const currentPos = { x, y, time: now };
    trailRef.current.push(currentPos);

    if (lastMousePos.current) {
      checkSlice(lastMousePos.current, currentPos);
      if (Math.random() < 0.15) sounds.playSwoosh();
    }

    lastMousePos.current = currentPos;
  };

  const handleMouseDown = () => {
    isMouseDown.current = true;
    currentSwipeSlices.current = 0;
  };

  const handleMouseUp = () => {
    isMouseDown.current = false;
    lastMousePos.current = null;
    currentSwipeSlices.current = 0;
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#F5F5F5] font-sans text-[#2C2C2C] select-none touch-none">
      {/* Figma Grid Background */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

      {/* Top Toolbar */}
      <div className="absolute top-0 left-0 right-0 h-12 bg-[#2C2C2C] flex items-center px-4 justify-between z-40 shadow-md">
        <div className="flex items-center gap-4">
          <div 
            className="w-8 h-8 flex items-center justify-center cursor-pointer hover:bg-white/10 rounded transition-colors"
            onClick={() => setGameState('menu')}
          >
            <svg width="20" height="30" viewBox="0 0 20 30" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 5C0 2.23858 2.23858 0 5 0H10V10H5C2.23858 10 0 7.76142 0 5Z" fill="#F24E1E"/>
              <path d="M0 15C0 12.2386 2.23858 10 5 10H10V20H5C2.23858 20 0 17.7614 0 15Z" fill="#A259FF"/>
              <path d="M0 25C0 22.2386 2.23858 20 5 20H10V25C10 27.7614 7.76142 30 5 30C2.23858 30 0 27.7614 0 25Z" fill="#1ABCFE"/>
              <path d="M10 0H15C17.7614 0 20 2.23858 20 5C20 7.76142 17.7614 10 15 10H10V0Z" fill="#FF7262"/>
              <path d="M10 10H15C17.7614 10 20 12.2386 20 15C20 17.7614 17.7614 20 15 20H10V10Z" fill="#0ACF83"/>
            </svg>
          </div>
          <button 
            onClick={() => setGameState('menu')}
            className="flex items-center gap-1 text-white/70 hover:text-white transition-colors text-xs font-medium px-2 py-1 rounded hover:bg-white/10"
          >
            <ChevronLeft size={16} />
            <span>Back</span>
          </button>
          <div className="hidden sm:flex gap-2">
            <div className="w-8 h-8 rounded hover:bg-white/10 flex items-center justify-center text-white/60"><MousePointer2 size={16} /></div>
            <div className="w-8 h-8 rounded hover:bg-white/10 flex items-center justify-center text-white/60"><Layers size={16} /></div>
            <div className="w-8 h-8 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center"><Zap size={16} /></div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Mobile HUD (Health & Score) */}
          {gameState === 'playing' && (
            <div className="flex md:hidden items-center gap-3 mr-2">
              <div className="flex gap-1">
                {[...Array(INITIAL_LIVES)].map((_, i) => (
                  <Component 
                    key={i} 
                    size={14} 
                    className={i < lives ? 'text-purple-500 fill-purple-500' : 'text-white/20'} 
                  />
                ))}
              </div>
              <span className="text-sm font-mono font-bold text-blue-400">{score}</span>
            </div>
          )}

          <div className="hidden sm:flex -space-x-2">
            <div className="w-6 h-6 rounded-full bg-purple-500 border-2 border-[#2C2C2C] flex items-center justify-center text-[8px] font-bold text-white">K</div>
            <div className="w-6 h-6 rounded-full bg-blue-500 border-2 border-[#2C2C2C] flex items-center justify-center text-[8px] font-bold text-white">A</div>
            <div className="w-6 h-6 rounded-full bg-green-500 border-2 border-[#2C2C2C] flex items-center justify-center text-[8px] font-bold text-white">+12</div>
          </div>
          <div className="hidden sm:block h-8 w-[1px] bg-white/10 mx-1" />
          <button 
            onClick={startGame}
            className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-2"
          >
            <Play size={12} fill="currentColor" />
            Present
          </button>
        </div>
      </div>

      {/* Side Panels */}
      <div className="hidden md:flex absolute top-12 left-0 bottom-0 w-[240px] bg-white border-r border-[#E6E6E6] z-30 p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between text-[11px] font-bold text-[#808080] uppercase tracking-wider">
          <span>Layers</span>
          <Layers size={12} />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-[#2C2C2C] bg-blue-50 p-1.5 rounded border border-blue-100">
            <Component size={14} className="text-purple-500" />
            <span className="font-medium">Main Page</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#808080] pl-4">
            <Square size={14} />
            <span>Background</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#808080] pl-4">
            <Circle size={14} />
            <span>Avatar</span>
          </div>
        </div>
      </div>

      <div className="hidden md:flex absolute top-12 right-0 bottom-0 w-[240px] bg-white border-l border-[#E6E6E6] z-30 p-4 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold text-[#808080] uppercase tracking-wider">Design</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[#F5F5F5] p-2 rounded text-[10px] text-[#2C2C2C] border border-[#E6E6E6]">
              <span className="block text-[#808080] mb-1">X</span>
              1,024
            </div>
            <div className="bg-[#F5F5F5] p-2 rounded text-[10px] text-[#2C2C2C] border border-[#E6E6E6]">
              <span className="block text-[#808080] mb-1">Y</span>
              768
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold text-[#808080] uppercase tracking-wider">Fill</span>
          <div className="flex items-center gap-2 bg-[#F5F5F5] p-2 rounded border border-[#E6E6E6]">
            <div className="w-4 h-4 rounded bg-blue-500 border border-black/10" />
            <span className="text-[10px] text-[#2C2C2C]">#18A0FB</span>
            <span className="text-[10px] text-[#808080] ml-auto">100%</span>
          </div>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onTouchMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        className="absolute inset-0 block w-full h-full cursor-none z-10"
      />

      {/* Combo Motivational Messages */}
      <AnimatePresence>
        {combo && (
          <motion.div
            key={combo.id}
            initial={{ opacity: 0, scale: 0.5, y: combo.y }}
            animate={{ opacity: 1, scale: 1.2, y: combo.y - 100 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="fixed pointer-events-none z-20 text-blue-500 font-bold text-3xl italic drop-shadow-lg"
            style={{ 
              left: Math.max(sidebarWidth + 100, Math.min(window.innerWidth - sidebarWidth - 100, combo.x)), 
              transform: 'translateX(-50%)' 
            }}
          >
            {combo.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Cursor */}
      {gameState === 'playing' && (
        <div 
          className="fixed pointer-events-none z-50 flex flex-col items-start"
          style={{ 
            left: lastMousePos.current?.x ?? -100, 
            top: lastMousePos.current?.y ?? -100,
            transition: 'none'
          }}
        >
          <MousePointer2 className="text-blue-500 fill-blue-500 w-5 h-5 drop-shadow-sm" />
          <div className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-sm font-medium mt-1 shadow-sm">
            {score > 100 ? 'Figma CEO' : score > 60 ? 'Design System Overlord' : score > 30 ? 'Auto-Layout Wizard' : score > 10 ? 'Pixel Pusher' : 'Intern (Don\'t touch anything)'}
          </div>
        </div>
      )}

      {/* Left Sidebar - Layers Panel */}
      <AnimatePresence>
        {gameState === 'playing' && (
          <motion.div 
            initial={{ x: -240 }}
            animate={{ x: 0 }}
            exit={{ x: -240 }}
            className="hidden md:flex absolute top-12 left-0 bottom-8 w-60 bg-white border-r border-[#E6E6E6] flex flex-col z-30"
          >
            <div className="p-3 border-b border-[#E6E6E6] flex items-center justify-between">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#B3B3B3]">Layers</h3>
              <Layers size={12} className="text-[#B3B3B3]" />
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {layersRef.current.map(l => (
                <div 
                  key={l.id} 
                  className={`px-4 py-1.5 flex items-center gap-3 hover:bg-blue-50 group cursor-default transition-opacity ${l.isSliced ? 'opacity-30 grayscale' : 'opacity-100'}`}
                >
                  <div className={`w-4 h-4 flex items-center justify-center ${l.isBomb ? 'text-red-500' : 'text-blue-500'}`}>
                    {l.isBomb ? <Bug size={12} /> : React.createElement(LAYER_TYPES.find(t => t.type === l.type)?.icon || Square, { size: 12 })}
                  </div>
                  <span className="text-xs text-[#2C2C2C] truncate flex-1">{l.name}</span>
                  {l.isSliced && <div className="text-[8px] text-gray-400 font-bold uppercase">Detached</div>}
                  {!l.isSliced && <div className="w-2 h-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: l.color }} />}
                </div>
              ))}
              {layersRef.current.length === 0 && (
                <div className="px-4 py-8 text-center text-[10px] text-[#B3B3B3] italic">
                  Canvas is empty
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HUD - Right Sidebar Style */}
      <AnimatePresence>
        {gameState === 'playing' && (
          <motion.div 
            initial={{ x: 240 }}
            animate={{ x: 0 }}
            exit={{ x: 240 }}
            className="hidden md:flex absolute top-12 right-0 bottom-0 w-60 bg-white border-l border-[#E6E6E6] p-4 flex flex-col gap-6 z-30"
          >
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#B3B3B3] mb-4">Properties</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[#808080]">Layers Flattened</span>
                  <span className="text-xl font-mono font-bold text-blue-500">{score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[#808080]">Best</span>
                  <span className="text-sm font-mono text-[#2C2C2C]">{highScore}</span>
                </div>
              </div>
            </section>

            <div className="h-[1px] bg-[#E6E6E6]" />

            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#B3B3B3] mb-4">Health</h3>
              <div className="flex gap-2">
                {[...Array(INITIAL_LIVES)].map((_, i) => (
                  <motion.div
                    key={i}
                    animate={{ scale: i < lives ? 1 : 0.8, opacity: i < lives ? 1 : 0.2 }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${i < lives ? 'bg-purple-50 text-purple-500 border border-purple-100' : 'bg-gray-50 text-gray-300 border border-gray-100'}`}
                  >
                    <Component size={16} className={i < lives ? 'fill-purple-500' : ''} />
                  </motion.div>
                ))}
              </div>
              <p className="text-[10px] text-[#B3B3B3] mt-2 italic">Don't slice the Main Component. It's too 'attached' to reality.</p>
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menu Overlay - Figma File Style */}
      <AnimatePresence>
        {gameState === 'menu' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-[#F5F5F5] z-50 overflow-y-auto"
          >
            <div className="w-full max-w-xl p-4 sm:p-8">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-white rounded-[32px] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] overflow-hidden border border-[#E6E6E6]"
              >
                {/* File Header */}
                <div className="bg-[#2C2C2C] p-5 flex items-center justify-between border-b border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-lg hover:bg-white/20 transition-colors cursor-pointer">
                      <svg width="20" height="30" viewBox="0 0 20 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M0 5C0 2.23858 2.23858 0 5 0H10V10H5C2.23858 10 0 7.76142 0 5Z" fill="#F24E1E"/>
                        <path d="M0 15C0 12.2386 2.23858 10 5 10H10V20H5C2.23858 20 0 17.7614 0 15Z" fill="#A259FF"/>
                        <path d="M0 25C0 22.2386 2.23858 20 5 20H10V25C10 27.7614 7.76142 30 5 30C2.23858 30 0 27.7614 0 25Z" fill="#1ABCFE"/>
                        <path d="M10 0H15C17.7614 0 20 2.23858 20 5C20 7.76142 17.7614 10 15 10H10V0Z" fill="#FF7262"/>
                        <path d="M10 10H15C17.7614 10 20 12.2386 20 15C20 17.7614 17.7614 20 15 20H10V10Z" fill="#0ACF83"/>
                      </svg>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 text-[10px] text-white/40 font-bold uppercase tracking-widest">
                        <span>Drafts</span>
                        <span>/</span>
                        <span className="text-white/60">Funtime Games</span>
                      </div>
                      <h1 className="text-xl font-bold text-white tracking-tight leading-tight">Figma Slice</h1>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex -space-x-2">
                      <div className="w-8 h-8 rounded-full bg-blue-500 border-2 border-[#2C2C2C] flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-blue-500/20">K</div>
                    </div>
                    <button className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95">Share</button>
                  </div>
                </div>

                <div className="p-4 sm:p-8 space-y-4 sm:space-y-8">
                  {/* Design Brief Card - Redesigned as a Figma Comment/Property Card */}
                  <div className="relative group/card">
                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-[24px] opacity-10 blur transition duration-1000 group-hover/card:opacity-20 group-hover/card:duration-200"></div>
                    <div className="relative bg-white rounded-2xl border border-[#E6E6E6] shadow-sm overflow-hidden">
                      <div className="bg-[#F5F5F5] px-4 py-2 border-b border-[#E6E6E6] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                          <span className="text-[10px] font-bold uppercase text-[#808080] tracking-wider">Design Brief</span>
                        </div>
                        <span className="text-[9px] text-[#B3B3B3] font-medium">Just now</span>
                      </div>
                      <div className="p-5 flex gap-4">
                        <div className="w-10 h-10 rounded-full bg-blue-100 flex-shrink-0 flex items-center justify-center text-blue-600 font-bold text-sm">
                          KA
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#2C2C2C]">Kamaline</span>
                            <span className="text-[10px] text-[#B3B3B3]">Designer</span>
                          </div>
                          <p className="text-sm text-[#4D4D4D] leading-relaxed italic">
                            "donot detach the component"
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:grid-cols-2 gap-6">
                    <div className="p-4 sm:p-5 bg-[#F9F9F9] rounded-2xl border border-[#E6E6E6] group/stat transition-colors hover:bg-white hover:border-blue-200">
                      <span className="block text-[10px] uppercase font-bold text-[#B3B3B3] mb-2 tracking-widest">Version History</span>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                        <span className="text-sm font-bold text-[#2C2C2C]">v1.0.4 Stable</span>
                      </div>
                      <span className="block text-[10px] text-[#B3B3B3] mt-1">Last edited 2m ago</span>
                    </div>
                    <div className="p-5 bg-[#F9F9F9] rounded-2xl border border-[#E6E6E6] group/stat transition-colors hover:bg-white hover:border-blue-200">
                      <span className="block text-[10px] uppercase font-bold text-[#B3B3B3] mb-2 tracking-widest">High Score</span>
                      <div className="flex items-center gap-1">
                        <Trophy size={14} className="text-yellow-500" />
                        <span className="text-2xl font-mono font-bold text-blue-600">{highScore}</span>
                      </div>
                    </div>
                  </div>

                  <div className="relative">
                    {/* Subtle Kamaline Cursor near button */}
                    <motion.div 
                      animate={{ x: [0, 10, -5, 0], y: [0, -5, 8, 0] }}
                      transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                      className="absolute -top-6 -right-4 z-10 pointer-events-none opacity-80"
                    >
                      <MousePointer2 className="text-blue-500 fill-blue-500 w-4 h-4 drop-shadow-sm" />
                      <div className="bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded-sm font-medium mt-1 shadow-sm whitespace-nowrap">
                        Kamaline
                      </div>
                    </motion.div>

                    <motion.button
                      onClick={startGame}
                      whileHover={{ 
                        scale: 1.02,
                        boxShadow: "0 20px 40px -12px rgba(59, 130, 246, 0.4)"
                      }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full py-5 bg-blue-500 hover:bg-blue-600 text-white rounded-2xl font-bold text-xl transition-all flex items-center justify-center gap-4 group relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                      <Play size={24} fill="currentColor" className="group-hover:scale-110 transition-transform" />
                      Run Prototype
                    </motion.button>
                  </div>

                  <div className="flex items-center justify-center gap-8 opacity-20 hover:opacity-40 transition-opacity">
                    <Square size={18} />
                    <Circle size={18} />
                    <Star size={18} />
                    <Hexagon size={18} />
                    <Component size={18} />
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Over Overlay - Figma Modal Style */}
      <AnimatePresence>
        {gameState === 'gameover' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm z-50"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden border border-[#E6E6E6]"
            >
              <div className="p-6 border-b border-[#E6E6E6] flex justify-between items-center">
                <h2 className="font-bold text-lg">Detached from Reality</h2>
                <div className="w-6 h-6 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400 cursor-pointer">✕</div>
              </div>
              
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-purple-50 text-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-purple-100">
                  <Component size={32} className="fill-purple-500" />
                </div>
                <h3 className="text-purple-600 font-bold mb-2 italic">"{pun}"</h3>
                <p className="text-gray-500 text-sm mb-8">Slicing a Main Component is a serious "instance" of bad judgment.</p>
                
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-lg">
                    <span className="text-xs text-gray-400 uppercase font-bold">Layers Flattened</span>
                    <span className="text-2xl font-mono font-bold text-blue-500">{score}</span>
                  </div>
                  
                  <button
                    onClick={startGame}
                    className="w-full py-4 bg-[#2C2C2C] hover:bg-black text-white rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={18} />
                    Re-link Instance
                  </button>
                  <button
                    onClick={() => setGameState('menu')}
                    className="w-full py-3 bg-white hover:bg-gray-50 text-gray-600 border border-[#E6E6E6] rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <ChevronLeft size={16} />
                    Back to Menu
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Status Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-white border-t border-[#E6E6E6] flex items-center px-4 justify-between text-[10px] text-[#808080] z-40">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>Connected</span>
          </div>
          <div className="h-3 w-[1px] bg-[#E6E6E6]" />
          <span>Page 1</span>
        </div>
        <div className="flex items-center gap-4">
          <span>100%</span>
          <div className="h-3 w-[1px] bg-[#E6E6E6]" />
          <span>{window.innerWidth} x {window.innerHeight}</span>
        </div>
      </div>
    </div>
  );
}


