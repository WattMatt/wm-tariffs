import React, { useEffect, useState } from 'react';

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  rotation: number;
  delay: number;
}

interface CelebrationProps {
  isActive: boolean;
  onComplete?: () => void;
  duration?: number;
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(45, 100%, 60%)', // Gold
  'hsl(280, 80%, 60%)', // Purple
  'hsl(160, 80%, 50%)', // Teal
  'hsl(340, 80%, 60%)', // Pink
  'hsl(200, 80%, 60%)', // Blue
];

export default function Celebration({ isActive, onComplete, duration = 3000 }: CelebrationProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isActive) {
      // Generate particles
      const newParticles: Particle[] = [];
      for (let i = 0; i < 100; i++) {
        newParticles.push({
          id: i,
          x: Math.random() * 100,
          y: -10 - Math.random() * 20,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          size: 6 + Math.random() * 8,
          rotation: Math.random() * 360,
          delay: Math.random() * 0.5,
        });
      }
      setParticles(newParticles);
      setVisible(true);

      // Clear after duration
      const timer = setTimeout(() => {
        setVisible(false);
        setParticles([]);
        onComplete?.();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [isActive, duration, onComplete]);

  if (!visible || particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute animate-confetti-fall"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            width: particle.size,
            height: particle.size,
            backgroundColor: particle.color,
            transform: `rotate(${particle.rotation}deg)`,
            animationDelay: `${particle.delay}s`,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          }}
        />
      ))}
      
      {/* Center sparkle burst */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-8 bg-gradient-to-t from-transparent via-yellow-400 to-white animate-sparkle-burst"
              style={{
                transformOrigin: 'center 100px',
                transform: `rotate(${i * 30}deg)`,
                animationDelay: `${i * 0.05}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Success text */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-celebration-text">
        <div className="text-4xl font-bold text-primary drop-shadow-lg animate-pulse">
          🎉 Complete! 🎉
        </div>
      </div>
    </div>
  );
}
