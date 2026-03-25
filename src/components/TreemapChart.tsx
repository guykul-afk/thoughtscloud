import { useMemo } from 'react';
import { cn } from '../App';

export interface TreemapNode {
  id: string;
  label: string;
  value: number;
  color?: string;
  icon?: string; // Emoji or Lucide icon name
  percentage?: string;
  status?: 'stress' | 'calm' | 'positive' | 'stable';
  children?: TreemapNode[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TreemapChartProps {
  data: TreemapNode[];
  width: number;
  height: number;
  className?: string;
}

interface PositionedNode extends TreemapNode {
  rect: Rect;
  children?: PositionedNode[];
}

const STATUS_COLORS = {
  stress: 'from-orange-400/90 to-rose-500/90 border-orange-600/40 shadow-orange-900/20',
  calm: 'from-emerald-300/90 to-teal-500/90 border-emerald-600/40 shadow-emerald-900/20',
  positive: 'from-amber-200/90 to-yellow-400/90 border-amber-500/40 shadow-yellow-900/20',
  stable: 'from-blue-300/90 to-indigo-500/90 border-blue-600/40 shadow-blue-900/20'
};

const STATUS_TEXTURES = {
  stress: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2) 0%, transparent 70%)',
  calm: 'radial-gradient(circle at 70% 20%, rgba(255,255,255,0.15) 0%, transparent 60%)',
  positive: 'radial-gradient(circle at 40% 80%, rgba(255,255,255,0.25) 0%, transparent 80%)',
  stable: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1) 0%, transparent 90%)'
};

const DEFAULT_GRADIENT = 'from-white/10 to-white/5 border-white/10';

export default function TreemapChart({ data, width, height, className }: TreemapChartProps) {
  
  const positionedData = useMemo(() => {
    
    // Slice-and-dice implementation
    const layout = (nodes: TreemapNode[], rect: Rect): PositionedNode[] => {
      if (!nodes.length) return [];
      
      const totalValue = nodes.reduce((sum, n) => sum + n.value, 0);
      let currentX = rect.x;
      let currentY = rect.y;
      
      return nodes.map((node) => {
        const ratio = totalValue === 0 ? 0 : node.value / totalValue;
        const nodeRect: Rect = { ...rect, x: currentX, y: currentY };
        
        if (rect.width > rect.height) {
          nodeRect.width = rect.width * ratio;
          currentX += nodeRect.width;
        } else {
          nodeRect.height = rect.height * ratio;
          currentY += nodeRect.height;
        }
        
        // Ensure minimum dimensions or handle 0
        nodeRect.width = Math.max(0, nodeRect.width);
        nodeRect.height = Math.max(0, nodeRect.height);

        const children = node.children 
          ? layout(node.children, { ...nodeRect, x: nodeRect.x + 2, y: nodeRect.y + 2, width: Math.max(0, nodeRect.width - 4), height: Math.max(0, nodeRect.height - 4) })
          : [];
        
        return { ...node, rect: nodeRect, children: children as PositionedNode[] };
      });
    };
    
    // Sort nodes by value for better visual balance
    const sortedData = [...data].sort((a, b) => b.value - a.value);
    return layout(sortedData, { x: 0, y: 0, width, height });
  }, [data, width, height]);

  const renderNode = (node: PositionedNode, depth: number = 0) => {
    const { rect, id, label, status, value, icon, percentage, children } = node;
    
    if (rect.width <= 4 || rect.height <= 4) return null;

    const bgClass = status ? STATUS_COLORS[status] : DEFAULT_GRADIENT;
    const isVerySmall = rect.width < 50 || rect.height < 40;
    const isMedium = rect.width > 70 && rect.height > 60;
    
    // Irregular, hand-drawn look using complex border-radius
    const borderRadius = depth === 0 
      ? "2rem" 
      : `${30 + Math.random() * 20}% ${50 + Math.random() * 30}% ${40 + Math.random() * 20}% ${60 + Math.random() * 20}% / ${50 + Math.random() * 20}% ${40 + Math.random() * 30}% ${60 + Math.random() * 20}% ${50 + Math.random() * 20}%`;

    // Subtle random rotation for hand-drawn feel
    const rotation = ((id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 5) - 2.5) * (depth === 0 ? 0.2 : 1);

    return (
      <g key={id} className="group cursor-pointer">
        <foreignObject 
          x={rect.x} 
          y={rect.y} 
          width={rect.width} 
          height={rect.height} 
          className="transition-all duration-700 overflow-visible"
        >
          <div 
            className={cn(
              "w-full h-full p-2 flex flex-col items-center justify-center overflow-hidden transition-all duration-500 group-hover:brightness-110 group-hover:scale-[1.02]",
              "bg-gradient-to-br border shadow-lg backdrop-blur-[2px]",
              bgClass,
              depth === 0 ? "rounded-[2rem] border-white/20" : "relative"
            )}
            style={{ 
              width: Math.max(0, rect.width - (depth === 0 ? 4 : 2)), 
              height: Math.max(0, rect.height - (depth === 0 ? 4 : 2)),
              margin: depth === 0 ? '2px' : '1px',
              borderRadius: depth === 0 ? '2rem' : borderRadius,
              transform: `rotate(${rotation}deg)`,
              backgroundImage: status ? `${STATUS_TEXTURES[status]}, linear-gradient(135deg, var(--tw-gradient-from), var(--tw-gradient-to))` : undefined
            }}
            dir="rtl"
          >
            {/* The "Hand-Drawn" Marker Border (only for depth > 0) */}
            {depth > 0 && (
                <div className="absolute inset-0 border-2 border-white/10 pointer-events-none opacity-40 mix-blend-overlay" style={{ borderRadius }} />
            )}

            <div className="flex flex-col items-center justify-center space-y-0.5 z-10">
                {icon && isMedium && (
                    <span className="text-xl mb-1 filter drop-shadow-sm">{icon}</span>
                )}
                
                {rect.width > 30 && rect.height > 25 && (
                    <span className={cn(
                        "text-white font-black truncate w-full text-center drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] px-0.5",
                        depth === 0 ? "text-sm uppercase tracking-wider" : isVerySmall ? "text-[8px]" : isMedium ? "text-[13px]" : "text-[10px]",
                        depth === 0 && "mb-auto mt-2"
                    )}>
                        {label}
                    </span>
                )}

                {percentage && isMedium && (
                    <span className="text-white/60 text-[9px] font-bold tracking-tighter bg-black/10 px-1.5 py-0.5 rounded-full">
                        {percentage}
                    </span>
                )}

                {!isVerySmall && !percentage && (
                <span className="text-white/50 text-[8px] font-mono opacity-80">
                    {Math.round(value)}
                </span>
                )}
            </div>

            {/* Render nested children if any */}
            {children && children.length > 0 && (
                <div className="w-full h-full mt-2 flex flex-wrap content-center justify-center gap-1 opacity-90">
                    {children.map(child => renderNode(child, depth + 1))}
                </div>
            )}
          </div>
        </foreignObject>
      </g>
    );
  };

  return (
    <svg 
      width="100%" 
      height={height} 
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible select-none", className)}
    >
      {positionedData.map(renderNode)}
    </svg>
  );
}
