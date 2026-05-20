import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleMap, Marker, InfoWindow, LoadScript } from '@react-google-maps/api';
import { MapPin, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { useCompanies } from '@/hooks/useCompanies';
import { useUsers } from '@/hooks/useUsers';
import { useEnergyConcessionaires } from '@/hooks/useEnergyConcessionaires';
import { useStaffAssignments } from '@/hooks/useProjectAssignments';
import { MapFilters, MapFilterState } from './MapFilters';
import { Badge } from '@/components/ui/badge';
import { ProjectWithDetails } from '@/hooks/useProjects';

const LIBRARIES: ('places')[] = ['places'];

const MAP_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8e8e8' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9e8f5' }] },
];

const STATUS_CONFIG: Record<string, { label: string; pinColor: string; badgeVariant: string }> = {
  pending:       { label: 'Aguardando',   pinColor: '#9CA3AF', badgeVariant: 'pending' },
  analysis:      { label: 'Em Análise',   pinColor: '#3B82F6', badgeVariant: 'analysis' },
  documentation: { label: 'Documentação', pinColor: '#F5A800', badgeVariant: 'progress' },
  approval:      { label: 'Aprovação',    pinColor: '#F97316', badgeVariant: 'progress' },
  approved:      { label: 'Aprovado',     pinColor: '#22C55E', badgeVariant: 'approved' },
  completed:     { label: 'Concluído',    pinColor: '#1A1A1A', badgeVariant: 'completed' },
};

function parseCoords(coords: string | null | undefined): google.maps.LatLngLiteral | null {
  if (!coords) return null;
  const parts = coords.split(',').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function markerIcon(color: string, opacity: number) {
  return {
    path: 0, // google.maps.SymbolPath.CIRCLE = 0
    scale: 9,
    fillColor: color,
    fillOpacity: opacity,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

interface DashboardMapProps {
  projects: ProjectWithDetails[];
  isLoading: boolean;
  userId?: string;
  userRole?: string;
  companyMode?: boolean;
}

export function DashboardMap({ projects, isLoading, userId, userRole, companyMode = false }: DashboardMapProps) {
  const navigate = useNavigate();
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;

  const [filters, setFilters] = useState<MapFilterState>({
    companyId: null, staffId: null, concessionaireId: null, status: null,
  });
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: companies = [] } = useCompanies();
  const { data: users = [] } = useUsers();
  const { data: concessionaires = [] } = useEnergyConcessionaires();
  const { data: staffAssignments = [] } = useStaffAssignments(userRole === 'staff' ? userId : undefined);

  const staffList = users.filter(u => u.role === 'staff');

  // For staff: only their assigned projects
  const roleFilteredProjects = useMemo(() => {
    if (userRole === 'staff' && userId) {
      const assignedProjectIds = new Set(staffAssignments.map(a => a.project_id));
      return projects.filter(p => assignedProjectIds.has(p.id));
    }
    return projects;
  }, [projects, userRole, userId, staffAssignments]);

  // Only with coords
  const mappable = useMemo(() =>
    roleFilteredProjects.filter(p => !!parseCoords(p.generalData?.coordinates)),
    [roleFilteredProjects]
  );

  // Apply all filters (AND logic)
  const visible = useMemo(() => mappable.filter(p => {
    if (filters.companyId && p.company_id !== filters.companyId) return false;
    if (filters.status && p.status !== filters.status) return false;
    if (filters.concessionaireId && p.concessionaire_id !== filters.concessionaireId) return false;
    // staffId filter: requires concessionaireId join — skipped for now (staff filters by role already)
    return true;
  }), [mappable, filters]);

  const selectedProject = visible.find(p => p.id === selectedId) ?? null;
  const selectedCoords = selectedProject ? parseCoords(selectedProject.generalData?.coordinates ?? null) : null;

  const handleMarkerClick = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  if (!apiKey) return null;

  const chipCompanies = companies.map(c => ({ id: c.id, label: c.name }));
  const chipStaff = staffList.map(u => ({ id: u.id, label: u.name }));
  const chipConc = concessionaires.map(c => ({ id: c.id, label: c.name }));

  const mapHeight = expanded ? 420 : 220;

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-visible" style={{ border: '0.5px solid rgba(245,168,0,0.15)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '0.5px solid #F0F0F0' }}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: '#FEF3D0' }}>
            <MapPin className="w-4 h-4" style={{ color: '#F5A800' }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Mapa de Projetos</p>
            <p className="text-xs" style={{ color: '#999' }}>
              {visible.length} projeto{visible.length !== 1 ? 's' : ''} visível{visible.length !== 1 ? 'eis' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '5px 9px', borderRadius: 6,
            border: '0.5px solid #E0E0E0', background: '#F8F8F8',
            fontSize: 11, color: '#555', cursor: 'pointer', fontWeight: 500,
          }}
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          {expanded ? 'Recolher' : 'Expandir'}
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-2.5" style={{ borderBottom: '0.5px solid #F0F0F0' }}>
        <MapFilters
          filters={filters}
          onChange={setFilters}
          companies={chipCompanies}
          staffList={chipStaff}
          concessionaires={chipConc}
          hideCompany={companyMode}
          hideStaff={companyMode}
        />
      </div>

      {/* Map */}
      <div style={{ height: mapHeight, position: 'relative', transition: 'height 0.3s ease' }}>
        {(isLoading) && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: 'rgba(255,255,255,0.8)' }}>
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#F5A800' }} />
          </div>
        )}

        <LoadScript
          googleMapsApiKey={apiKey}
          libraries={LIBRARIES}
          loadingElement={
            <div className="absolute inset-0 flex items-center justify-center z-10 gap-2" style={{ background: 'rgba(255,255,255,0.8)', color: '#999', fontSize: 12 }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#F5A800' }} />
              Carregando mapa...
            </div>
          }
        >
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={selectedCoords ?? { lat: -15.7801, lng: -47.9292 }}
            zoom={selectedCoords ? 14 : 5}
            options={{
              styles: MAP_STYLES,
              streetViewControl: false,
              mapTypeControl: false,
              fullscreenControl: false,
              zoomControl: true,
              zoomControlOptions: { position: 3 },
            }}
            onClick={() => setSelectedId(null)}
          >
            {mappable.map(project => {
              const pos = parseCoords(project.generalData?.coordinates ?? null);
              if (!pos) return null;
              const cfg = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.pending;
              const isVisible = visible.some(v => v.id === project.id);
              return (
                <Marker
                  key={project.id}
                  position={pos}
                  icon={markerIcon(cfg.pinColor, isVisible ? 1 : 0.2)}
                  onClick={() => isVisible && handleMarkerClick(project.id)}
                />
              );
            })}

            {selectedProject && selectedCoords && (
              <InfoWindow
                position={selectedCoords}
                onCloseClick={() => setSelectedId(null)}
              >
                <div style={{ fontFamily: 'Inter, sans-serif', minWidth: 210, maxWidth: 240, padding: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: '#F5A800' }}>
                      {selectedProject.code}
                    </span>
                    <span style={{
                      display: 'inline-block',
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      background: STATUS_CONFIG[selectedProject.status]?.pinColor ?? '#ccc',
                      color: ['completed', 'pending'].includes(selectedProject.status) ? '#fff' : '#fff',
                    }}>
                      {STATUS_CONFIG[selectedProject.status]?.label}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#1A1A1A', marginBottom: 4 }}>
                    {selectedProject.generalData?.holder_name || selectedProject.title}
                  </p>
                  {selectedProject.companyName && (
                    <p style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>
                      🏢 {selectedProject.companyName}
                    </p>
                  )}
                  {selectedProject.concessionaireName && (
                    <p style={{ fontSize: 10, color: '#888', marginBottom: 2 }}>
                      ⚡ {selectedProject.concessionaireName}
                    </p>
                  )}
                  {selectedProject.generalData?.city && (
                    <p style={{ fontSize: 10, color: '#888', marginBottom: 8 }}>
                      📍 {selectedProject.generalData.city}/{selectedProject.generalData.state}
                    </p>
                  )}
                  <button
                    onClick={() => navigate(`/project/${selectedProject.id}`)}
                    style={{
                      width: '100%', padding: '6px 0',
                      background: '#F5A800', color: '#1A1A1A',
                      border: 'none', borderRadius: 6,
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Ver projeto →
                  </button>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </LoadScript>

        {!isLoading && mappable.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: 'rgba(255,255,255,0.85)' }}>
            <MapPin className="w-8 h-8 mb-2" style={{ color: '#E0E0E0' }} />
            <p style={{ fontSize: 13, color: '#999', textAlign: 'center' }}>
              Nenhum projeto com localização cadastrada
            </p>
          </div>
        )}
      </div>

      {/* Expanded panel — project list */}
      {expanded && visible.length > 0 && (
        <div style={{ borderTop: '0.5px solid #F0F0F0', padding: '12px 16px' }}>
          <p style={{ fontSize: 11, color: '#999', fontWeight: 500, marginBottom: 8 }}>
            {visible.length} projeto{visible.length !== 1 ? 's' : ''} no filtro atual
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {visible.map(p => (
              <button
                key={p.id}
                onClick={() => navigate(`/project/${p.id}`)}
                style={{
                  background: '#fff', borderRadius: 7,
                  border: '0.5px solid #E8E8E8',
                  padding: '8px 10px', textAlign: 'left', cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
              >
                <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#F5A800', fontWeight: 700, marginBottom: 2 }}>
                  {p.code}
                </p>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#1A1A1A', marginBottom: 4, lineHeight: 1.3 }}>
                  {p.generalData?.holder_name || p.title}
                </p>
                <p style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{p.companyName}</p>
                <Badge
                  variant={(STATUS_CONFIG[p.status]?.badgeVariant || 'pending') as any}
                  className="text-[10px] py-0"
                >
                  {STATUS_CONFIG[p.status]?.label || p.status}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
