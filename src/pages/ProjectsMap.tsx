import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { GoogleMap, Marker, InfoWindow, LoadScript } from '@react-google-maps/api';
import { Loader2, MapPin, Building2, ArrowRight, X } from 'lucide-react';
import { motion } from 'framer-motion';

const LIBRARIES: ('places')[] = ['places'];

const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a0a0b0' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a3e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a5e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a0a1e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; pinColor: string }> = {
  pending:       { label: 'Aguardando',    color: 'bg-muted',             pinColor: '#6b7280' },
  analysis:      { label: 'Em Análise',    color: 'bg-kanban-analysis',   pinColor: '#0ea5e9' },
  documentation: { label: 'Documentação',  color: 'bg-kanban-progress',   pinColor: '#f59e0b' },
  approval:      { label: 'Aprovação',     color: 'bg-kanban-progress',   pinColor: '#f97316' },
  approved:      { label: 'Aprovado',      color: 'bg-kanban-approved',   pinColor: '#22c55e' },
  completed:     { label: 'Concluído',     color: 'bg-kanban-completed',  pinColor: '#16a34a' },
};

const STATUS_BADGE_VARIANT: Record<string, string> = {
  pending: 'pending', analysis: 'analysis', documentation: 'progress',
  approval: 'progress', approved: 'approved', completed: 'completed',
};

function parseCoords(coords: string | null | undefined): google.maps.LatLngLiteral | null {
  if (!coords) return null;
  const parts = coords.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function markerIcon(color: string): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

export default function ProjectsMap() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: projects = [], isLoading } = useProjects();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

  const [activeStatuses, setActiveStatuses] = useState<Record<string, boolean>>(
    Object.fromEntries(Object.keys(STATUS_CONFIG).map(k => [k, true]))
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const toggleStatus = (status: string) => {
    setActiveStatuses(prev => ({ ...prev, [status]: !prev[status] }));
  };

  // Filter projects by role
  const roleFilteredProjects = projects.filter(p => {
    if (user?.role === 'company') return p.company_id === user.companyId;
    // admin and staff see all (staff assignment filter would need another query — left to server)
    return true;
  });

  // Only projects with parseable coordinates
  const mappableProjects = roleFilteredProjects.filter(p => {
    const coords = p.generalData?.coordinates;
    return !!parseCoords(coords);
  });

  // Apply status filter
  const visibleProjects = mappableProjects.filter(p => activeStatuses[p.status]);

  const selectedProject = visibleProjects.find(p => p.id === selectedProjectId) ?? null;
  const selectedCoords = selectedProject ? parseCoords(selectedProject.generalData?.coordinates ?? null) : null;

  // Center on Brazil by default
  const defaultCenter = { lat: -15.7801, lng: -47.9292 };

  const handleMarkerClick = useCallback((projectId: string) => {
    setSelectedProjectId(prev => prev === projectId ? null : projectId);
  }, []);

  if (!apiKey) {
    return (
      <MainLayout>
        <div className="flex items-center gap-2 p-6 rounded-lg bg-destructive/10 text-destructive">
          <MapPin className="w-5 h-5" />
          Chave VITE_GOOGLE_MAPS_API_KEY não configurada no arquivo .env
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">Mapa de Projetos</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {mappableProjects.length} projeto(s) com localização cadastrada
            </p>
          </div>
        </div>

        {/* Status filter */}
        <div className="kpi-card py-3">
          <div className="flex flex-wrap gap-4">
            {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
              <div key={status} className="flex items-center gap-2">
                <Checkbox
                  id={`filter-${status}`}
                  checked={activeStatuses[status]}
                  onCheckedChange={() => toggleStatus(status)}
                />
                <Label htmlFor={`filter-${status}`} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cfg.pinColor }} />
                  {cfg.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Map */}
        <div className="relative rounded-xl overflow-hidden border border-white/10 shadow-xl"
          style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          <LoadScript
            googleMapsApiKey={apiKey}
            libraries={LIBRARIES}
            loadingElement={
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10 gap-2 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                Carregando mapa...
              </div>
            }
          >
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={selectedCoords ?? defaultCenter}
              zoom={selectedCoords ? 14 : 5}
              options={{
                styles: MAP_STYLES,
                streetViewControl: false,
                mapTypeControl: false,
                fullscreenControl: true,
                zoomControl: true,
              }}
              onClick={() => setSelectedProjectId(null)}
            >
              {visibleProjects.map(project => {
                const pos = parseCoords(project.generalData?.coordinates ?? null);
                if (!pos) return null;
                const cfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.pending;
                return (
                  <Marker
                    key={project.id}
                    position={pos}
                    icon={markerIcon(cfg.pinColor)}
                    onClick={() => handleMarkerClick(project.id)}
                  />
                );
              })}

              {selectedProject && selectedCoords && (
                <InfoWindow
                  position={selectedCoords}
                  onCloseClick={() => setSelectedProjectId(null)}
                >
                  <div style={{ background: '#1e1e2e', color: '#f0f0f8', padding: '12px', borderRadius: '8px', minWidth: '220px', fontFamily: 'Inter, sans-serif' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#f97316' }}>{selectedProject.code}</span>
                    </div>
                    <p style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', color: '#f0f0f8' }}>
                      {selectedProject.generalData?.holder_name || selectedProject.title}
                    </p>
                    <p style={{ fontSize: '12px', color: '#a0a0b0', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>🏢</span> {selectedProject.companyName}
                    </p>
                    {selectedProject.generalData?.city && (
                      <p style={{ fontSize: '12px', color: '#a0a0b0', marginBottom: '8px' }}>
                        📍 {selectedProject.generalData.city}/{selectedProject.generalData.state}
                      </p>
                    )}
                    <div style={{ marginBottom: '10px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: STATUS_CONFIG[selectedProject.status]?.pinColor ?? '#6b7280',
                        color: '#fff',
                      }}>
                        {STATUS_CONFIG[selectedProject.status]?.label ?? selectedProject.status}
                      </span>
                    </div>
                    <button
                      onClick={() => navigate(`/project/${selectedProject.id}`)}
                      style={{
                        width: '100%',
                        padding: '6px 12px',
                        background: '#f97316',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Ver projeto →
                    </button>
                  </div>
                </InfoWindow>
              )}
            </GoogleMap>
          </LoadScript>

          {/* Empty state overlay */}
          {!isLoading && mappableProjects.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 z-10 gap-3">
              <MapPin className="w-12 h-12 text-muted-foreground" />
              <p className="text-lg font-semibold text-foreground">Nenhum projeto com localização</p>
              <p className="text-sm text-muted-foreground text-center max-w-xs">
                Adicione coordenadas aos projetos para visualizá-los no mapa.
              </p>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-sidebar/95 backdrop-blur border border-sidebar-border rounded-xl p-3 shadow-xl z-10">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Legenda</p>
            <div className="space-y-1.5">
              {Object.entries(STATUS_CONFIG).map(([status, cfg]) => (
                <div key={status} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cfg.pinColor }} />
                  <span className="text-xs text-foreground">{cfg.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
