import { useRef, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Center, Float, Text, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore, type DiaryEntry } from '../store';

function Star({ entry, position, onSelect }: { entry: DiaryEntry; position: [number, number, number]; onSelect: (entry: DiaryEntry) => void }) {
    const meshRef = useRef<THREE.Mesh>(null);

    return (
        <group position={position}>
            <mesh ref={meshRef} onClick={() => onSelect(entry)}>
                <sphereGeometry args={[0.15, 16, 16]} />
                <meshStandardMaterial
                    color="#FFD54F"
                    emissive="#FFD54F"
                    emissiveIntensity={2}
                    toneMapped={false}
                />
            </mesh>
            <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
                <Text
                    position={[0, 0.4, 0]}
                    fontSize={0.15}
                    color="white"
                    anchorX="center"
                    anchorY="middle"
                    font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff"
                >
                    {new Date(entry.timestamp).toLocaleDateString('he-IL')}
                </Text>
            </Float>
        </group>
    );
}

function Connections({ entries, positions }: { entries: DiaryEntry[], positions: [number, number, number][] }) {
    const lines = useMemo(() => {
        const connectors = [];
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const entryA = entries[i];
                const entryB = entries[j];

                // Connect if they share at least one topic
                const commonTopics = entryA.topics.filter(t => entryB.topics.includes(t));
                if (commonTopics.length > 0) {
                    connectors.push({
                        start: positions[i],
                        end: positions[j],
                        id: `${entryA.timestamp}-${entryB.timestamp}`
                    });
                }
            }
        }
        return connectors;
    }, [entries, positions]);

    return (
        <group>
            {lines.map(line => (
                <line key={line.id}>
                    <bufferGeometry attach="geometry" onUpdate={self => self.setFromPoints([new THREE.Vector3(...line.start), new THREE.Vector3(...line.end)])} />
                    <lineBasicMaterial attach="material" color="#5FA5CF" transparent opacity={0.3} />
                </line>
            ))}
        </group>
    );
}

export default function Constellation({ onSelectEntry }: { onSelectEntry: (entry: DiaryEntry) => void }) {
    const { entries } = useAppStore();

    // Generate random positions for entries (stable based on timestamp)
    const positions = useMemo(() => {
        return entries.map((_, i) => {
            const radius = 5;
            const phi = Math.acos(-1 + (2 * i) / (entries.length || 1));
            const theta = Math.sqrt((entries.length || 1) * Math.PI) * phi;

            return [
                radius * Math.cos(theta) * Math.sin(phi),
                radius * Math.sin(theta) * Math.sin(phi),
                radius * Math.cos(phi)
            ] as [number, number, number];
        });
    }, [entries]);

    if (entries.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-white/50">
                אין מספיק מחשבות בשביל ליצור מרחב...
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-transparent">
            <Canvas camera={{ position: [0, 0, 10], fov: 60 }}>
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <OrbitControls enablePan={false} maxDistance={20} minDistance={3} />

                <Center>
                    <group>
                        {entries.map((entry, i) => (
                            <Star
                                key={entry.timestamp}
                                entry={entry}
                                position={positions[i]}
                                onSelect={onSelectEntry}
                            />
                        ))}
                        <Connections entries={entries} positions={positions} />
                    </group>
                </Center>
            </Canvas>
        </div>
    );
}
