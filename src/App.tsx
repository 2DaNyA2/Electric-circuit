import { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Trash2, RotateCw, X, Send, Info, Hand, PenTool, Eraser, BookOpen, Calculator, Plus, Minus, Sliders } from 'lucide-react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { GoogleGenAI } from "@google/genai";

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type ComponentType = 'wire' | 'wire_node' | 'wire_cross' | 'cell' | 'battery' | 'resistor' | 'heater' | 'fuse' | 'bell' | 'socket' | 'terminals' | 'switch' | 'lamp' | 'ammeter' | 'voltmeter';
type Mode = 'draw' | 'pan' | 'erase' | 'edit';

interface GridCell {
  x: number;
  y: number;
  type: ComponentType;
  rotation: number;
  value?: number;
}

const GRID_WIDTH = 20;
const GRID_HEIGHT = 15;
const CELL_SIZE = 40;

function solveLinearSystem(A: number[][], Z: number[]): number[] | null {
  const n = Z.length;
  for (let i = 0; i < n; i++) {
    let maxEl = Math.abs(A[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > maxEl) {
        maxEl = Math.abs(A[k][i]);
        maxRow = k;
      }
    }
    if (maxEl < 1e-10) return null;

    const tmpA = A[maxRow];
    A[maxRow] = A[i];
    A[i] = tmpA;
    const tmpZ = Z[maxRow];
    Z[maxRow] = Z[i];
    Z[i] = tmpZ;

    for (let k = i + 1; k < n; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < n; j++) {
        if (i === j) A[k][j] = 0;
        else A[k][j] += c * A[i][j];
      }
      Z[k] += c * Z[i];
    }
  }

  const X = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    X[i] = Z[i] / A[i][i];
    for (let k = i - 1; k >= 0; k--) {
      Z[k] -= A[k][i] * X[i];
    }
  }
  return X;
}

const COMPONENT_NAMES: Record<ComponentType, string> = {
  wire: 'Провід',
  wire_node: 'З\'єднання проводів',
  wire_cross: 'Перетин проводів',
  cell: 'Гальванічний елемент',
  battery: 'Батарея',
  resistor: 'Резистор',
  heater: 'Нагрівальний елемент',
  fuse: 'Запобіжник',
  bell: 'Електричний дзвінок',
  socket: 'Штепсельна розетка',
  terminals: 'Затискачі',
  switch: 'Ключ',
  lamp: 'Електрична лампа',
  ammeter: 'Амперметр',
  voltmeter: 'Вольтметр',
};

const COMPONENT_PROPS: Record<ComponentType, { r: number, v: number }> = {
  wire: { r: 0, v: 0 },
  wire_node: { r: 0, v: 0 },
  wire_cross: { r: 0, v: 0 },
  cell: { r: 0, v: 1.5 },
  battery: { r: 0, v: 9 },
  resistor: { r: 10, v: 0 },
  heater: { r: 20, v: 0 },
  fuse: { r: 0.1, v: 0 },
  bell: { r: 5, v: 0 },
  socket: { r: Infinity, v: 0 },
  terminals: { r: Infinity, v: 0 },
  switch: { r: 0, v: 0 }, 
  lamp: { r: 15, v: 0 },
  ammeter: { r: 0, v: 0 },
  voltmeter: { r: Infinity, v: 0 },
};

export default function App() {
  const [cells, setCells] = useState<Record<string, GridCell>>({});
  const [selectedTool, setSelectedTool] = useState<ComponentType>('wire');
  const [currentRotation, setCurrentRotation] = useState<number>(0);
  const [mode, setMode] = useState<Mode>('draw');
  const [editingCell, setEditingCell] = useState<string | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  
  // Calculator State
  const [calcT, setCalcT] = useState<number>(60);
  const [calcUOverride, setCalcUOverride] = useState<number | ''>('');

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string }[]>([
    { sender: 'sh', text: 'Привіт! Я sh. Чим можу допомогти з електричними колами?' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const keyBuffer = useRef<string>('');
  const gridRef = useRef<HTMLDivElement>(null);
  const logoTapCount = useRef(0);
  const logoTapTimeout = useRef<NodeJS.Timeout | null>(null);

  // Secret code listener (Keyboard)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keyBuffer.current += e.key;
      if (keyBuffer.current.length > 6) {
        keyBuffer.current = keyBuffer.current.slice(-6);
      }
      if (keyBuffer.current === '676767') {
        setIsChatOpen(true);
        keyBuffer.current = '';
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Secret code listener (Mobile Tap)
  const handleLogoTap = () => {
    logoTapCount.current += 1;
    if (logoTapTimeout.current) clearTimeout(logoTapTimeout.current);
    
    if (logoTapCount.current >= 2) {
      setIsChatOpen(true);
      logoTapCount.current = 0;
    } else {
      logoTapTimeout.current = setTimeout(() => {
        logoTapCount.current = 0;
      }, 300);
    }
  };

  useEffect(() => {
    const handleMouseUp = () => setIsDrawing(false);
    const handleTouchEnd = () => setIsDrawing(false);
    
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
    
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const handleCellClick = useCallback((x: number, y: number) => {
    const key = `${x},${y}`;
    if (mode === 'erase') {
      setCells(prev => {
        const newCells = { ...prev };
        delete newCells[key];
        return newCells;
      });
      return;
    }
    if (mode === 'edit') {
      if (cells[key] && ['resistor', 'heater', 'lamp', 'fuse', 'bell', 'cell', 'battery'].includes(cells[key].type)) {
        setEditingCell(key);
      }
      return;
    }
    if (mode === 'draw') {
      setCells(prev => {
        const newCells = { ...prev };
        newCells[key] = { x, y, type: selectedTool, rotation: currentRotation };
        return newCells;
      });
    }
  }, [mode, selectedTool, currentRotation, cells]);

  const handleTouchMove = (e: React.TouchEvent) => {
    if (mode === 'pan') return;
    // Prevent default to stop scrolling while drawing
    if (e.cancelable) e.preventDefault();
    
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;
    if (el && el.dataset.x !== undefined && el.dataset.y !== undefined) {
      handleCellClick(Number(el.dataset.x), Number(el.dataset.y));
    }
  };

  const clearGrid = () => {
    if (window.confirm('Ви впевнені, що хочете очистити схему?')) {
      setCells({});
    }
  };

  const exportPDF = async () => {
    if (!gridRef.current) return;
    try {
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '-9999px';
      container.style.width = '1000px';
      container.style.backgroundColor = 'white';
      container.style.padding = '40px';
      container.style.fontFamily = 'sans-serif';
      
      const title = document.createElement('h1');
      title.textContent = 'Електрична схема';
      title.style.fontSize = '24px';
      title.style.marginBottom = '20px';
      title.style.color = '#1e293b';
      container.appendChild(title);
      
      const gridClone = gridRef.current.cloneNode(true) as HTMLElement;
      gridClone.style.border = '1px solid #e2e8f0';
      gridClone.style.marginBottom = '30px';
      gridClone.style.width = `${GRID_WIDTH * CELL_SIZE}px`;
      gridClone.style.height = `${GRID_HEIGHT * CELL_SIZE}px`;
      gridClone.style.display = 'flex';
      gridClone.style.flexWrap = 'wrap';
      container.appendChild(gridClone);
      
      const subtitle = document.createElement('h2');
      subtitle.textContent = 'Використані елементи:';
      subtitle.style.fontSize = '18px';
      subtitle.style.marginBottom = '10px';
      subtitle.style.color = '#334155';
      container.appendChild(subtitle);
      
      const list = document.createElement('ul');
      list.style.listStyleType = 'none';
      list.style.padding = '0';
      
      const counts: Record<string, number> = {};
      Object.values(cells).forEach(cell => {
        counts[cell.type] = (counts[cell.type] || 0) + 1;
      });
      
      Object.entries(counts).forEach(([type, count]) => {
        const li = document.createElement('li');
        li.textContent = `- ${COMPONENT_NAMES[type as ComponentType]}: ${count}`;
        li.style.fontSize = '14px';
        li.style.marginBottom = '5px';
        li.style.color = '#475569';
        list.appendChild(li);
      });
      container.appendChild(list);
      
      document.body.appendChild(container);
      
      const imgData = await toPng(container, { pixelRatio: 2, backgroundColor: '#ffffff' });
      document.body.removeChild(container);
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('схема.pdf');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Помилка при експорті PDF');
    }
  };

  const hasNeighbor = useCallback((x: number, y: number, dx: number, dy: number) => {
    const neighborKey = `${x + dx},${y + dy}`;
    return !!cells[neighborKey];
  }, [cells]);

  const analyzeCircuit = useCallback(() => {
    const parent = new Map<string, string>();
    const find = (i: string): string => {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) === i) return i;
      const p = find(parent.get(i)!);
      parent.set(i, p);
      return p;
    };
    const union = (i: string, j: string) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent.set(rootI, rootJ);
    };

    const portKey = (x: number, y: number, p: number) => `${x},${y},${p}`;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (x < GRID_WIDTH - 1) union(portKey(x, y, 1), portKey(x + 1, y, 3));
        if (y < GRID_HEIGHT - 1) union(portKey(x, y, 2), portKey(x, y + 1, 0));
      }
    }

    const components: { key: string, type: ComponentType, u: string, v: string, val: number }[] = [];

    Object.entries(cells).forEach(([key, cell]) => {
      const { x, y, type, rotation, value } = cell;
      
      if (type === 'wire') {
        const activePorts = [];
        if (hasNeighbor(x, y, 0, -1)) activePorts.push(0);
        if (hasNeighbor(x, y, 1, 0)) activePorts.push(1);
        if (hasNeighbor(x, y, 0, 1)) activePorts.push(2);
        if (hasNeighbor(x, y, -1, 0)) activePorts.push(3);
        
        for (let i = 1; i < activePorts.length; i++) {
          union(portKey(x, y, activePorts[0]), portKey(x, y, activePorts[i]));
        }
      } else if (type === 'wire_node') {
        union(portKey(x, y, 0), portKey(x, y, 1));
        union(portKey(x, y, 1), portKey(x, y, 2));
        union(portKey(x, y, 2), portKey(x, y, 3));
      } else if (type === 'wire_cross') {
        union(portKey(x, y, 0), portKey(x, y, 2));
        union(portKey(x, y, 1), portKey(x, y, 3));
      } else {
        let pA = 3, pB = 1;
        if (rotation === 90) { pA = 0; pB = 2; }
        else if (rotation === 180) { pA = 1; pB = 3; }
        else if (rotation === 270) { pA = 2; pB = 0; }
        
        if (type === 'switch' || type === 'terminals') {
          union(portKey(x, y, pA), portKey(x, y, pB));
        } else {
          const defaultProps = COMPONENT_PROPS[type];
          let val = value !== undefined ? value : (defaultProps.v > 0 ? defaultProps.v : defaultProps.r);
          components.push({ key, type, u: portKey(x, y, pA), v: portKey(x, y, pB), val });
        }
      }
    });

    const nodes = new Set<string>();
    components.forEach(c => {
      c.u = find(c.u);
      c.v = find(c.v);
      nodes.add(c.u);
      nodes.add(c.v);
    });

    const adj = new Map<string, string[]>();
    nodes.forEach(n => adj.set(n, []));
    components.forEach(c => {
      adj.get(c.u)!.push(c.v);
      adj.get(c.v)!.push(c.u);
    });

    const visited = new Set<string>();
    const connectedComponents: string[][] = [];
    nodes.forEach(n => {
      if (!visited.has(n)) {
        const comp: string[] = [];
        const q = [n];
        visited.add(n);
        while (q.length > 0) {
          const curr = q.shift()!;
          comp.push(curr);
          adj.get(curr)!.forEach(neighbor => {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              q.push(neighbor);
            }
          });
        }
        connectedComponents.push(comp);
      }
    });

    const cellResults: Record<string, { v: number, i: number, r?: number }> = {};
    let totalP = 0;
    let error: string | null = null;

    connectedComponents.forEach(compNodes => {
      const compComps = components.filter(c => compNodes.includes(c.u));
      const vSources = compComps.filter(c => c.type === 'cell' || c.type === 'battery' || c.type === 'ammeter');
      
      if (vSources.length === 0) {
        compComps.forEach(c => {
          cellResults[c.key] = { v: 0, i: 0, r: c.val };
        });
        return;
      }

      const nodeToIndex = new Map<string, number>();
      compNodes.forEach((n, i) => nodeToIndex.set(n, i));
      
      const N = compNodes.length;
      const M = vSources.length;
      const matrixSize = (N - 1) + M;
      
      const A = Array(matrixSize).fill(0).map(() => Array(matrixSize).fill(0));
      const Z = Array(matrixSize).fill(0);

      let shortCircuit = false;

      compComps.forEach(c => {
        const uIdx = nodeToIndex.get(c.u)!;
        const vIdx = nodeToIndex.get(c.v)!;
        
        if (c.type === 'cell' || c.type === 'battery' || c.type === 'ammeter') {
          // Handled below
        } else {
          let r = c.val;
          if (r < 1e-6) r = 1e-6;
          const g = 1 / r;
          if (uIdx > 0) A[uIdx - 1][uIdx - 1] += g;
          if (vIdx > 0) A[vIdx - 1][vIdx - 1] += g;
          if (uIdx > 0 && vIdx > 0) {
            A[uIdx - 1][vIdx - 1] -= g;
            A[vIdx - 1][uIdx - 1] -= g;
          }
        }
      });

      vSources.forEach((c, idx) => {
        const uIdx = nodeToIndex.get(c.u)!;
        const vIdx = nodeToIndex.get(c.v)!;
        const mIdx = (N - 1) + idx;
        
        if (uIdx === vIdx && c.val > 0) {
          shortCircuit = true;
        }

        if (uIdx > 0) {
          A[uIdx - 1][mIdx] += 1;
          A[mIdx][uIdx - 1] += 1;
        }
        if (vIdx > 0) {
          A[vIdx - 1][mIdx] -= 1;
          A[mIdx][vIdx - 1] -= 1;
        }
        Z[mIdx] = c.type === 'ammeter' ? 0 : c.val;
      });

      if (shortCircuit) {
        error = 'Коротке замикання джерела живлення!';
        return;
      }

      const X = solveLinearSystem(A, Z);
      if (!X) {
        error = 'Помилка розрахунку (можливо, коротке замикання)';
        return;
      }

      const nodeVoltages = new Array(N).fill(0);
      for (let i = 1; i < N; i++) {
        nodeVoltages[i] = X[i - 1];
      }

      compComps.forEach(c => {
        const uIdx = nodeToIndex.get(c.u)!;
        const vIdx = nodeToIndex.get(c.v)!;
        const vu = nodeVoltages[uIdx];
        const vv = nodeVoltages[vIdx];
        const vDrop = vu - vv;
        
        if (c.type === 'cell' || c.type === 'battery' || c.type === 'ammeter') {
          const sIdx = vSources.indexOf(c);
          const i = X[(N - 1) + sIdx];
          cellResults[c.key] = { v: Math.abs(vDrop), i: Math.abs(i) };
          if (c.type !== 'ammeter') {
            totalP += Math.abs(vDrop * i);
          }
        } else {
          let r = c.val;
          if (r < 1e-6) r = 1e-6;
          const i = vDrop / r;
          cellResults[c.key] = { v: Math.abs(vDrop), i: Math.abs(i), r: c.val };
        }
      });
    });

    return { cellResults, totalP, error };
  }, [cells, hasNeighbor]);

  const circuitData = analyzeCircuit();
  const activeP = circuitData.totalP;
  const activeA = activeP * calcT;

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;
    
    const userText = chatInput;
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setChatInput('');
    setIsGenerating(true);
    
    try {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      }

      // The platform injects the key into process.env.API_KEY or process.env.GEMINI_API_KEY
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: userText,
        config: {
          systemInstruction: "Ти помічник-електрик. Допомагай користувачу з електричними колами. Відповідай коротко і по суті українською мовою."
        }
      });

      setChatMessages(prev => [...prev, { sender: 'sh', text: response.text || 'Немає відповіді' }]);
    } catch (error: any) {
      console.error(error);
      if (error?.message?.includes('Requested entity was not found')) {
        if (window.aistudio?.openSelectKey) {
          await window.aistudio.openSelectKey();
        }
      }
      setChatMessages(prev => [...prev, { sender: 'sh', text: 'Помилка з\'єднання з API. Перевірте ключ та спробуйте ще раз.' }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderComponent = (cell: GridCell, isToolIcon = false) => {
    const { x, y, type, rotation } = cell;
    const cellResult = circuitData.cellResults[`${x},${y}`];
    
    if (type === 'wire') {
      let top = false, right = false, bottom = false, left = false;
      
      if (isToolIcon) {
        left = true;
        right = true;
      } else {
        top = hasNeighbor(x, y, 0, -1);
        right = hasNeighbor(x, y, 1, 0);
        bottom = hasNeighbor(x, y, 0, 1);
        left = hasNeighbor(x, y, -1, 0);
      }
      
      const noNeighbors = !top && !right && !bottom && !left;

      return (
        <svg width="40" height="40" className="absolute inset-0 pointer-events-none overflow-visible">
          <g stroke="black" strokeWidth="2" strokeLinecap="round">
            {noNeighbors && <circle cx="20" cy="20" r="3" fill="black" />}
            {top && <line x1="20" y1="20" x2="20" y2="0" />}
            {right && <line x1="20" y1="20" x2="40" y2="20" />}
            {bottom && <line x1="20" y1="20" x2="20" y2="40" />}
            {left && <line x1="20" y1="20" x2="0" y2="20" />}
          </g>
        </svg>
      );
    }

    return (
      <svg width="40" height="40" className="absolute inset-0 pointer-events-none overflow-visible">
        <g transform={`rotate(${rotation} 20 20)`} stroke="black" strokeWidth="2" fill="none">
          {type !== 'wire' && type !== 'wire_node' && type !== 'wire_cross' && (
            <>
              <line x1="0" y1="20" x2="10" y2="20" />
              <line x1="30" y1="20" x2="40" y2="20" />
            </>
          )}
          
          {type === 'wire_node' && (
            <g>
              <line x1="0" y1="20" x2="40" y2="20" />
              <line x1="20" y1="20" x2="20" y2="0" />
              <circle cx="20" cy="20" r="3" fill="black" />
            </g>
          )}

          {type === 'wire_cross' && (
            <g>
              <line x1="0" y1="20" x2="40" y2="20" />
              <line x1="20" y1="0" x2="20" y2="40" />
            </g>
          )}
          
          {type === 'cell' && (
            <g>
              <line x1="15" y1="10" x2="15" y2="30" strokeWidth="2" />
              <line x1="25" y1="14" x2="25" y2="26" strokeWidth="4" />
              <line x1="0" y1="20" x2="15" y2="20" />
              <line x1="25" y1="20" x2="40" y2="20" />
            </g>
          )}
          
          {type === 'battery' && (
            <g>
              <line x1="12" y1="10" x2="12" y2="30" strokeWidth="2" />
              <line x1="18" y1="14" x2="18" y2="26" strokeWidth="4" />
              <line x1="18" y1="20" x2="22" y2="20" strokeDasharray="2 2" />
              <line x1="22" y1="10" x2="22" y2="30" strokeWidth="2" />
              <line x1="28" y1="14" x2="28" y2="26" strokeWidth="4" />
              <line x1="0" y1="20" x2="12" y2="20" />
              <line x1="28" y1="20" x2="40" y2="20" />
            </g>
          )}
          
          {type === 'resistor' && (
            <rect x="10" y="14" width="20" height="12" fill="white" />
          )}

          {type === 'heater' && (
            <g>
              <rect x="10" y="14" width="20" height="12" fill="white" />
              <line x1="15" y1="14" x2="15" y2="26" />
              <line x1="20" y1="14" x2="20" y2="26" />
              <line x1="25" y1="14" x2="25" y2="26" />
            </g>
          )}

          {type === 'fuse' && (
            <g>
              <rect x="10" y="14" width="20" height="12" fill="white" />
              <line x1="0" y1="20" x2="40" y2="20" strokeWidth="1" />
            </g>
          )}

          {type === 'socket' && (
            <g>
              <line x1="0" y1="16" x2="40" y2="16" />
              <path d="M 17 13 L 21 16 L 17 19" fill="none" />
              <path d="M 21 13 L 25 16 L 21 19" fill="none" />
              <line x1="0" y1="24" x2="40" y2="24" />
              <path d="M 17 21 L 21 24 L 17 27" fill="none" />
              <path d="M 21 21 L 25 24 L 21 27" fill="none" />
            </g>
          )}

          {type === 'terminals' && (
            <g>
              <line x1="0" y1="20" x2="14" y2="20" />
              <circle cx="17" cy="20" r="3" fill="white" />
              <circle cx="23" cy="20" r="3" fill="white" />
              <line x1="26" y1="20" x2="40" y2="20" />
            </g>
          )}
          
          {type === 'lamp' && (
            <g>
              <circle cx="20" cy="20" r="10" fill="white" />
              <line x1="13" y1="13" x2="27" y2="27" />
              <line x1="13" y1="27" x2="27" y2="13" />
            </g>
          )}
          
          {type === 'switch' && (
            <g>
              <line x1="0" y1="20" x2="12" y2="20" />
              <circle cx="12" cy="20" r="2" fill="black" />
              <circle cx="28" cy="20" r="2" fill="black" />
              <line x1="12" y1="20" x2="26" y2="10" />
              <line x1="28" y1="20" x2="40" y2="20" />
            </g>
          )}
          
          {type === 'ammeter' && (
            <g>
              <circle cx="20" cy="20" r="10" fill="white" />
              <text x="20" y="24" textAnchor="middle" fontSize="12" strokeWidth="0" fill="black" fontWeight="bold">A</text>
            </g>
          )}
          
          {type === 'voltmeter' && (
            <g>
              <circle cx="20" cy="20" r="10" fill="white" />
              <text x="20" y="24" textAnchor="middle" fontSize="12" strokeWidth="0" fill="black" fontWeight="bold">V</text>
            </g>
          )}
          
          {type === 'bell' && (
            <g>
              <path d="M 10 12 A 10 10 0 0 0 30 12 Z" fill="white" />
              <line x1="10" y1="20" x2="16" y2="20" />
              <line x1="30" y1="20" x2="24" y2="20" />
              <line x1="16" y1="20" x2="16" y2="12" />
              <line x1="24" y1="20" x2="24" y2="12" />
            </g>
          )}
        </g>
      </svg>
    );
  };

  const renderGrid = () => {
    const grid = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const key = `${x},${y}`;
        const cell = cells[key];
        const cellResult = circuitData.cellResults[key];
        
        grid.push(
          <div
            key={key}
            data-x={x}
            data-y={y}
            className={`border border-slate-200/50 flex items-center justify-center relative ${mode === 'pan' ? 'cursor-grab' : 'cursor-crosshair'} hover:bg-slate-100`}
            style={{ width: CELL_SIZE, height: CELL_SIZE, flexShrink: 0 }}
            onMouseDown={(e) => {
              if (e.button === 0 && mode !== 'pan') {
                setIsDrawing(true);
                handleCellClick(x, y);
              }
            }}
            onMouseEnter={() => {
              if (isDrawing && mode !== 'pan') {
                handleCellClick(x, y);
              }
            }}
            onTouchStart={(e) => {
              if (mode !== 'pan') {
                setIsDrawing(true);
                handleCellClick(x, y);
              }
            }}
            onDoubleClick={(e) => {
              if (cell && ['resistor', 'heater', 'lamp', 'fuse', 'bell', 'cell', 'battery'].includes(cell.type)) {
                setEditingCell(key);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setCells(prev => {
                const newCells = { ...prev };
                delete newCells[key];
                return newCells;
              });
            }}
          >
            {cell && renderComponent(cell)}
            
            {/* HTML Label for values */}
            {cell && !['wire', 'wire_node', 'wire_cross', 'switch', 'terminals', 'socket'].includes(cell.type) && (
              <div 
                className={`absolute -top-2 left-1/2 -translate-x-1/2 bg-white/95 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap z-10 shadow-sm border ${
                  cell.type === 'ammeter' ? 'text-emerald-600 border-emerald-200' : 
                  cell.type === 'voltmeter' ? 'text-sky-600 border-sky-200' : 
                  'text-slate-700 border-slate-200 cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (['resistor', 'heater', 'lamp', 'fuse', 'bell', 'cell', 'battery'].includes(cell.type)) {
                    setEditingCell(key);
                  }
                }}
              >
                {cell.type === 'ammeter' && cellResult ? `${cellResult.i.toFixed(2)} А` : null}
                {cell.type === 'voltmeter' && cellResult ? `${cellResult.v.toFixed(2)} В` : null}
                {['resistor', 'heater', 'lamp', 'fuse', 'bell', 'cell', 'battery'].includes(cell.type) && (
                  `${cell.value !== undefined ? cell.value : (COMPONENT_PROPS[cell.type].v > 0 ? COMPONENT_PROPS[cell.type].v : COMPONENT_PROPS[cell.type].r)} ${COMPONENT_PROPS[cell.type].v > 0 ? 'В' : 'Ом'}`
                )}
              </div>
            )}
          </div>
        );
      }
    }
    return grid;
  };

  const componentCounts = Object.values(cells).reduce((acc, cell) => {
    acc[cell.type] = (acc[cell.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="h-[100dvh] w-full bg-slate-50 flex flex-col font-sans text-slate-900 overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div 
            onClick={handleLogoTap}
            className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-md cursor-pointer select-none"
          >
            ⚡
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Закони струму</h1>
            <p className="text-[11px] text-slate-500">З'єднання, робота, потужність</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCalculator(true)} className="p-2.5 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors">
            <Calculator size={18} />
          </button>
          <button onClick={() => setShowFormulas(true)} className="p-2.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
            <BookOpen size={18} />
          </button>
          <button onClick={() => setShowInfo(true)} className="p-2.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
            <Info size={18} />
          </button>
          <button onClick={clearGrid} className="p-2.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">
            <Trash2 size={18} />
          </button>
          <button onClick={exportPDF} className="p-2.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors">
            <Download size={18} />
          </button>
        </div>
      </header>

      {/* Main Canvas Area */}
      <main className="flex-1 overflow-auto bg-slate-100 relative z-0">
        <div className="min-w-max min-h-max p-4 md:p-8 flex items-center justify-center">
          <div 
            className="bg-white shadow-xl rounded-lg overflow-hidden border border-slate-200"
            style={{ 
              width: GRID_WIDTH * CELL_SIZE, 
              height: GRID_HEIGHT * CELL_SIZE
            }}
          >
            <div 
              ref={gridRef}
              className="relative w-full h-full flex flex-wrap"
              style={{ 
                width: GRID_WIDTH * CELL_SIZE, 
                height: GRID_HEIGHT * CELL_SIZE,
                touchAction: mode === 'pan' ? 'auto' : 'none'
              }}
              onTouchMove={handleTouchMove}
              onDragOver={(e) => e.preventDefault()}
            >
              {renderGrid()}
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Toolbar */}
      <div className="bg-white border-t border-slate-200 shrink-0 pb-safe z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        {/* Controls Row */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 overflow-x-auto gap-4">
          <div className="flex bg-slate-100 rounded-lg p-1 shrink-0">
            <button 
              onClick={() => setMode('draw')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] md:text-xs font-medium transition-colors ${mode === 'draw' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
            >
              <PenTool size={14} /> <span className="hidden xs:inline">Малювати</span>
            </button>
            <button 
              onClick={() => setMode('erase')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] md:text-xs font-medium transition-colors ${mode === 'erase' ? 'bg-white shadow-sm text-red-600' : 'text-slate-500'}`}
            >
              <Eraser size={14} /> <span className="hidden xs:inline">Стерти</span>
            </button>
            <button 
              onClick={() => setMode('pan')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] md:text-xs font-medium transition-colors ${mode === 'pan' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
            >
              <Hand size={14} /> <span className="hidden xs:inline">Рухати</span>
            </button>
            <button 
              onClick={() => setMode('edit')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] md:text-xs font-medium transition-colors ${mode === 'edit' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500'}`}
            >
              <Sliders size={14} /> <span className="hidden xs:inline">Налаштувати</span>
            </button>
          </div>
          
          <button 
            onClick={() => setCurrentRotation(r => (r + 90) % 360)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] md:text-xs font-medium active:bg-indigo-100 transition-colors shrink-0"
          >
            <RotateCw size={14} style={{ transform: `rotate(${currentRotation}deg)` }} className="transition-transform duration-200" />
            {currentRotation}°
          </button>
        </div>

        {/* Components Scroll Row */}
        <div className="flex overflow-x-auto px-3 py-3 gap-3 hide-scrollbar items-center scroll-smooth">
          {(Object.keys(COMPONENT_NAMES) as ComponentType[]).map((type) => (
            <button
              key={type}
              onClick={() => {
                setSelectedTool(type);
                setMode('draw');
              }}
              className={`shrink-0 w-[64px] h-[64px] md:w-[72px] md:h-[72px] flex flex-col items-center justify-center rounded-xl border-2 transition-all ${
                selectedTool === type && mode === 'draw'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm scale-105' 
                  : 'border-slate-100 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div className="w-8 h-8 relative mb-1 pointer-events-none flex items-center justify-center">
                <div className="scale-[0.6] md:scale-[0.65] origin-center">
                  {renderComponent({ x: 0, y: 0, type, rotation: 0 }, true)}
                </div>
              </div>
              <span className="text-[8px] md:text-[9px] text-center font-medium leading-tight px-1 w-full truncate">
                {COMPONENT_NAMES[type]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {editingCell && cells[editingCell] && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">Налаштування</h3>
              <button onClick={() => setEditingCell(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-bold text-slate-700 mb-2">
                {COMPONENT_PROPS[cells[editingCell].type].v > 0 ? 'Напруга (В)' : 'Опір (Ом)'}
              </label>
              <input 
                type="number" 
                autoFocus
                defaultValue={cells[editingCell].value !== undefined ? cells[editingCell].value : (COMPONENT_PROPS[cells[editingCell].type].v > 0 ? COMPONENT_PROPS[cells[editingCell].type].v : COMPONENT_PROPS[cells[editingCell].type].r)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCells(prev => ({
                    ...prev,
                    [editingCell]: { ...prev[editingCell], value: val }
                  }));
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setEditingCell(null)} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
                Готово
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">Інформація</h3>
              <button onClick={() => setShowInfo(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <p className="text-sm text-slate-600 mb-4">
                <strong>Малювати:</strong> Оберіть елемент знизу та натискайте на сітку. Для проводів можна проводити пальцем.<br/><br/>
                <strong>Стерти:</strong> Оберіть режим "Стерти" та натискайте на елементи, щоб їх видалити.<br/><br/>
                <strong>Рухати:</strong> Увімкніть режим "Рухати", щоб переглядати велику схему жестами.
              </p>
              <h4 className="font-bold text-sm text-slate-800 mb-2">Використані елементи:</h4>
              {Object.entries(componentCounts).length === 0 ? (
                <p className="text-xs text-slate-400 italic">Схема порожня</p>
              ) : (
                <ul className="text-sm space-y-2">
                  {Object.entries(componentCounts).map(([type, count]) => (
                    <li key={type} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                      <span className="text-slate-700">{COMPONENT_NAMES[type as ComponentType]}</span>
                      <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-slate-100 flex flex-col gap-4">
              <div className="text-center">
                <span className="text-xs text-slate-400 uppercase tracking-widest">Автор</span>
                <div className="font-serif italic text-xl text-indigo-800 mt-1">Ленич Даниїл</div>
              </div>
              <button onClick={() => setShowInfo(false)} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors">
                Зрозуміло
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulas Modal */}
      {showFormulas && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">Формули та Закони</h3>
              <button onClick={() => setShowFormulas(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh] space-y-4 text-sm text-slate-700">
              
              <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                <h4 className="font-bold text-indigo-900 mb-2">Послідовне з'єднання</h4>
                <p className="font-mono bg-white px-2 py-1 rounded border border-indigo-50 mb-1">I = I₁ = I₂</p>
                <p className="font-mono bg-white px-2 py-1 rounded border border-indigo-50 mb-1">U = U₁ + U₂</p>
                <p className="font-mono bg-white px-2 py-1 rounded border border-indigo-50">R = R₁ + R₂</p>
              </div>

              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                <h4 className="font-bold text-emerald-900 mb-2">Паралельне з'єднання</h4>
                <p className="font-mono bg-white px-2 py-1 rounded border border-emerald-50 mb-1">U = U₁ = U₂</p>
                <p className="font-mono bg-white px-2 py-1 rounded border border-emerald-50 mb-1">I = I₁ + I₂</p>
                <p className="font-mono bg-white px-2 py-1 rounded border border-emerald-50">1/R = 1/R₁ + 1/R₂</p>
              </div>

              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                <h4 className="font-bold text-amber-900 mb-2">Робота і Потужність</h4>
                <p className="font-mono bg-white px-2 py-1 rounded border border-amber-50 mb-1">A = U · I · t</p>
                <p className="font-mono bg-white px-2 py-1 rounded border border-amber-50">P = U · I = I² · R = U² / R</p>
              </div>

              <div className="bg-rose-50 p-3 rounded-xl border border-rose-100">
                <h4 className="font-bold text-rose-900 mb-2">Закон Джоуля-Ленца</h4>
                <p className="text-xs text-rose-800 mb-2">Кількість теплоти, що виділяється в провіднику:</p>
                <p className="font-mono bg-white px-2 py-1 rounded border border-rose-50 text-lg text-center font-bold">Q = I² · R · t</p>
              </div>

            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setShowFormulas(false)} className="w-full py-2.5 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors">
                Зрозуміло
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calculator Modal */}
      {showCalculator && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Calculator size={18} className="text-amber-600" />
                Калькулятор кола
              </h3>
              <button onClick={() => setShowCalculator(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto flex-1 space-y-5">
              
              {circuitData.error ? (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm font-medium flex items-center justify-center text-center">
                  {circuitData.error}
                </div>
              ) : (
                <>
                  {/* Main Parameters */}
                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1 uppercase tracking-wider">Час роботи (t), с</label>
                      <input 
                        type="number" 
                        value={calcT} 
                        onChange={e => setCalcT(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  {/* Results */}
                  <div className="bg-slate-800 rounded-xl p-4 text-white shadow-inner">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Результати обчислень</h4>
                    <div className="grid grid-cols-1 xs:grid-cols-2 gap-y-3 gap-x-4">
                      <div className="bg-slate-700/30 p-2 rounded-lg">
                        <div className="text-slate-400 text-[10px] mb-0.5 uppercase">Загальна Потужність (P)</div>
                        <div className="font-mono text-lg font-bold text-indigo-400">{activeP.toFixed(2)} Вт</div>
                      </div>
                      <div className="bg-slate-700/30 p-2 rounded-lg">
                        <div className="text-slate-400 text-[10px] mb-0.5 uppercase">Загальна Теплота (Q)</div>
                        <div className="font-mono text-lg font-bold text-rose-400">{activeA.toFixed(2)} Дж</div>
                      </div>
                    </div>
                  </div>
                </>
              )}

            </div>
            <div className="p-4 border-t border-slate-100 shrink-0">
              <button onClick={() => setShowCalculator(false)} className="w-full py-2.5 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition-colors">
                Закрити
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Modal */}
      {isChatOpen && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="font-mono font-bold">sh terminal</span>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => window.aistudio?.openSelectKey?.()} 
                className="text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded border border-slate-700 transition-colors"
                title="Змінити API ключ"
              >
                API Ключ
              </button>
              <button onClick={() => setIsChatOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>
          
          <div className="h-80 p-4 overflow-y-auto flex flex-col gap-3 bg-slate-50">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                  msg.sender === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-sm' 
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
          
          <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-100 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isGenerating}
              placeholder={isGenerating ? "Зачекайте..." : "Введіть повідомлення..."}
              className="flex-1 bg-slate-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl px-4 py-2 text-sm transition-all outline-none disabled:opacity-50"
            />
            <button 
              type="submit"
              disabled={!chatInput.trim() || isGenerating}
              className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
