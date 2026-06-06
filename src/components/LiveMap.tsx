import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { RefreshCw, Layers } from 'lucide-react';
import { Course, Driver, Neighborhood } from '../types';
import { dakarNeighborhoods } from '../initialData';

// Custom calibrate translation: percentage (0-100) local space to Senegal GPS space
const getLatLng = (x: number, y: number): [number, number] => {
  // If GPS like, use directly
  if (x > 12 && x < 17 && y > -18 && y < -12) {
    return [x, y];
  }
  if (y > 12 && y < 17 && x > -18 && x < -12) {
    return [y, x];
  }
  
  // Projection logic
  const lng = -17.72 + (x * 2.1) / 100;
  const lat = 15.20 - (y * 0.78) / 100;
  return [lat, lng];
};

interface LiveMapProps {
  courses: Course[];
  drivers: Driver[];
  selectedCourse: Course | null;
  onSelectCourse: (course: Course | null) => void;
  selectedDriver: Driver | null;
  onSelectDriver: (driver: Driver | null) => void;
  isSimulating: boolean;
  onToggleSimulation: () => void;
  simulationSpeed: number;
  setSimulationSpeed: (speed: number) => void;
}

export default function LiveMap({
  courses,
  drivers,
  selectedCourse,
  onSelectCourse,
  selectedDriver,
  onSelectDriver,
  isSimulating,
  onToggleSimulation,
  simulationSpeed,
  setSimulationSpeed,
}: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<Neighborhood | null>(null);
  const [showRoads, setShowRoads] = useState(true);

  const activeDrivers = drivers.filter(d => d.status !== 'offline');

  // 1. Map Initialization
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Center on region spanning Dakar-Touba
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
    }).setView([14.78, -16.85], 9);

    // Beautiful slate-900 matching tilemap (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors, © CartoDB'
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;
    mapRef.current = map;

    // Call invalidate size multiple times on layout transition to ensure correct rendering
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
    setTimeout(() => {
      map.invalidateSize();
    }, 500);
    setTimeout(() => {
      map.invalidateSize();
    }, 1200);

    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2. Center map on selection
  useEffect(() => {
    if (!mapRef.current) return;
    if (selectedDriver) {
      const [lat, lng] = getLatLng(selectedDriver.coords.x, selectedDriver.coords.y);
      mapRef.current.setView([lat, lng], 11, { animate: true });
    }
  }, [selectedDriver?.id]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (selectedCourse) {
      const [lat, lng] = getLatLng(selectedCourse.pickupCoords.x, selectedCourse.pickupCoords.y);
      mapRef.current.setView([lat, lng], 10, { animate: true });
    }
  }, [selectedCourse?.id]);

  // 3. Redraw content dynamically on updates
  useEffect(() => {
    const map = mapRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    // 3.1. Neighborhood Markers
    dakarNeighborhoods.forEach((n) => {
      const isSelected = selectedNeighborhood?.name === n.name;
      const [lat, lng] = getLatLng(n.coords.x, n.coords.y);

      const htmlString = `
        <div class="flex flex-col items-center cursor-pointer select-none">
          <div class="w-2 h-2 rounded-full border border-slate-600 transition-all ${
            isSelected ? 'bg-blue-400 scale-125 shadow-lg shadow-blue-400' : 'bg-slate-700'
          }"></div>
          <span class="text-[9px] font-medium tracking-tight mt-1 px-1.5 py-0.5 rounded transition-all select-none ${
            isSelected
              ? 'bg-blue-600 text-white font-bold text-[10px] shadow-sm z-30'
              : 'bg-slate-900/85 text-slate-400'
          }">
            ${n.name}
          </span>
        </div>
      `;

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          html: htmlString,
          className: 'custom-neighborhood-marker',
          iconSize: [60, 30],
          iconAnchor: [30, 5],
        })
      });

      marker.on('click', () => {
        setSelectedNeighborhood(isSelected ? null : n);
      });

      marker.addTo(markersLayer);

      if (isSelected) {
        const popupHtml = `
          <div class="p-2.5 bg-slate-950 text-slate-100 border border-slate-800 rounded-lg shadow-2xl w-44 font-sans text-xs">
            <h4 class="text-[11px] font-bold text-white mb-0.5">${n.name}</h4>
            <p class="text-[9px] text-slate-400 leading-normal mb-1">${n.description}</p>
            <div class="text-[8px] font-mono font-bold text-blue-400 flex justify-between uppercase">
              <span>Coords: ${n.coords.x}, ${n.coords.y}</span>
            </div>
          </div>
        `;
        marker.bindPopup(popupHtml, {
          closeButton: false,
          className: 'custom-leaflet-popup-card',
          offset: [0, 15]
        }).openPopup();
      }
    });

    // 3.2. Dynamic courses path and markers
    courses.forEach((course) => {
      const isSelected = selectedCourse?.id === course.id;
      const isPending = course.status === 'pending';
      const isRouteActive = course.status === 'on_trip' || course.status === 'en_route_pickup' || course.status === 'assigned';

      if (!isPending && !isRouteActive) return;

      const [pLat, pLng] = getLatLng(course.pickupCoords.x, course.pickupCoords.y);
      const [dLat, dLng] = getLatLng(course.dropoffCoords.x, course.dropoffCoords.y);

      // Pickup pin
      const pickupHtml = `
        <div class="flex flex-col items-center cursor-pointer select-none" style="transform: translate(-50%, -100%);">
          <div class="px-2 py-0.5 rounded-md text-[9px] font-bold text-white shadow-lg border flex items-center gap-1 leading-none ${
            isSelected
              ? 'bg-blue-500 border-blue-400'
              : isPending
              ? 'bg-amber-500 border-amber-400 animate-bounce'
              : 'bg-slate-800 border-slate-700'
          }">
            <span class="w-2.5 h-2.5 bg-white rounded-full flex items-center justify-center text-[8px] text-slate-900 font-extrabold font-mono">D</span>
            <span>DEPART: ${course.pickup}</span>
          </div>
          <div class="w-2 h-2 -mt-0.5 border-l border-t rotate-45 ${
            isSelected ? 'bg-blue-500 border-blue-400' : isPending ? 'bg-amber-500 border-amber-400' : 'bg-slate-800 border-slate-700'
          }"></div>
        </div>
      `;

      const pMarker = L.marker([pLat, pLng], {
        icon: L.divIcon({
          html: pickupHtml,
          className: 'custom-pickup-marker',
          iconSize: [200, 40],
          iconAnchor: [100, 40]
        })
      });

      pMarker.on('click', () => {
        onSelectCourse(course);
      });
      pMarker.addTo(markersLayer);

      // Dropoff pin for selected course
      if (isSelected) {
        const dropoffHtml = `
          <div class="flex flex-col items-center cursor-pointer select-none" style="transform: translate(-50%, -100%);">
            <div class="px-2 py-0.5 rounded-md text-[9px] font-bold bg-rose-600 border border-rose-500 text-white shadow-lg flex items-center gap-1 leading-none">
              <span class="w-2.5 h-2.5 bg-white rounded-full flex items-center justify-center text-[8px] text-rose-600 font-extrabold font-mono">A</span>
              <span>ARRIVEE: ${course.dropoff}</span>
            </div>
            <div class="w-2 h-2 -mt-0.5 bg-rose-600 border-rose-500 border-l border-t rotate-45"></div>
          </div>
        `;

        const dMarker = L.marker([dLat, dLng], {
          icon: L.divIcon({
            html: dropoffHtml,
            className: 'custom-dropoff-marker',
            iconSize: [200, 40],
            iconAnchor: [100, 40]
          })
        });

        dMarker.on('click', () => {
          onSelectCourse(course);
        });
        dMarker.addTo(markersLayer);

        // Path drawing
        if (course.status === 'on_trip') {
          const ratio = course.progress / 100;
          const currentLat = pLat + (dLat - pLat) * ratio;
          const currentLng = pLng + (dLng - pLng) * ratio;

          // Green completed line
          L.polyline([[pLat, pLng], [currentLat, currentLng]], {
            color: '#10b981',
            weight: 4,
            opacity: 0.82
          }).addTo(markersLayer);

          // Blue dotted remaining line
          L.polyline([[currentLat, currentLng], [dLat, dLng]], {
            color: '#3b82f6',
            weight: 3,
            dashArray: '5, 5',
            opacity: 0.7
          }).addTo(markersLayer);
        } else {
          // Full blue route
          L.polyline([[pLat, pLng], [dLat, dLng]], {
            color: '#3b82f6',
            weight: 3.5,
            dashArray: '5, 5',
            opacity: 0.75
          }).addTo(markersLayer);
        }
      } else {
        // Dotted grey routes for unselected active courses
        L.polyline([[pLat, pLng], [dLat, dLng]], {
          color: '#475569',
          weight: 1.5,
          dashArray: '4, 4',
          opacity: 0.35
        }).addTo(markersLayer);
      }
    });

    // 3.3. Active Driver Cars
    activeDrivers.forEach((driver) => {
      const isSelected = selectedDriver?.id === driver.id;
      const isBusy = driver.status === 'on_trip';
      const isAssigned = courses.some(c => c.driverId === driver.id && c.status === 'assigned');

      let colorClass = 'bg-emerald-500 text-emerald-950 shadow-emerald-500/30';
      let borderClass = 'border-emerald-300';
      if (isBusy) {
        colorClass = 'bg-rose-500 text-rose-950 shadow-rose-500/30';
        borderClass = 'border-rose-300';
      } else if (isAssigned) {
        colorClass = 'bg-blue-500 text-blue-950 shadow-blue-500/30';
        borderClass = 'border-blue-300';
      }

      const [lat, lng] = getLatLng(driver.coords.x, driver.coords.y);

      const htmlString = `
        <div class="flex flex-col items-center select-none" style="transform: translate(-50%, -120%);">
          <div class="bg-slate-900/95 border border-slate-700 text-[8px] font-bold text-slate-200 px-1.5 py-0.2 rounded shadow-md whitespace-nowrap mb-1">
            ${driver.name.split(' ')[0]} (${driver.batteryOrFuel}%)
          </div>
          <div class="relative w-7 h-7 rounded-full flex items-center justify-center border-2 border-solid shadow-lg ${colorClass} ${borderClass}">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 transform rotate-45 ${isBusy ? 'animate-pulse' : ''}" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="3 11 22 2 13 21 11 13 3 11" />
            </svg>
            ${isSelected ? '<span class="absolute inset-x-0 inset-y-0 w-7 h-7 rounded-full border border-blue-400 animate-ping opacity-60"></span>' : ''}
          </div>
        </div>
      `;

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          html: htmlString,
          className: 'custom-driver-marker',
          iconSize: [40, 50],
          iconAnchor: [20, 50],
        })
      });

      marker.on('click', () => {
        onSelectDriver(driver);
      });

      marker.addTo(markersLayer);
    });

  }, [courses, drivers, selectedCourse, selectedDriver, selectedNeighborhood]);

  return (
    <div id="live-map-container" className="flex flex-col h-full bg-slate-950 text-slate-100 font-sans relative overflow-hidden select-none">
      {/* Top Map Action Bar */}
      <div className="absolute top-4 left-4 right-4 z-[1000] flex flex-wrap gap-2 items-center justify-between pointer-events-none">
        <div className="bg-slate-900/95 border border-slate-800 rounded-xl px-4 py-2.5 shadow-xl flex items-center gap-3 backdrop-blur-sm pointer-events-auto">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
          <div>
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              Supervision Dakar OSM Map
              <span className="text-[10px] uppercase font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">GPS OK</span>
            </div>
            <div className="text-[10px] text-slate-400 font-medium">
              Vitesse simulation: <span className="text-blue-400 font-semibold">{simulationSpeed}x</span> · {activeDrivers.length} balises actives
            </div>
          </div>
        </div>

        {/* Map view controllers */}
        <div className="flex gap-2 pointer-events-auto">
          <div className="bg-slate-900/95 border border-slate-800 rounded-xl p-1 shadow-xl flex items-center gap-1 backdrop-blur-sm">
            <button
              onClick={() => onToggleSimulation()}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                isSimulating
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 animate-pulse'
                  : 'bg-slate-800 text-slate-300 hover:text-white border border-transparent'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSimulating ? 'animate-spin' : ''}`} />
              <span>{isSimulating ? 'Simulation Live' : 'Simuler'}</span>
            </button>

            <select
              value={simulationSpeed}
              onChange={(e) => setSimulationSpeed(Number(e.target.value))}
              disabled={!isSimulating}
              className="bg-slate-800 border-none text-xs text-white px-2 py-1.5 rounded-lg font-medium focus:ring-0 cursor-pointer disabled:opacity-40"
            >
              <option value="1">1x (Lent)</option>
              <option value="2">2x (Normal)</option>
              <option value="5">5x (Rapide)</option>
              <option value="10">10x (Super)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Interactive Leaflet Map Area */}
      <div 
        ref={mapContainerRef} 
        className="flex-1 w-full h-full z-0" 
        style={{ background: '#0f172a' }}
      />

      {/* Map Legend Footer Panel */}
      <div className="p-3 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 z-10 font-sans">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-300 shadow-md"></span>
            <span className="text-[11px] font-semibold text-slate-300">Disponible</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 border border-rose-300 shadow-md"></span>
            <span className="text-[11px] font-semibold text-slate-300">En course VTC</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 border border-blue-300 shadow-md"></span>
            <span className="text-[11px] font-semibold text-slate-300">Assigné / Rejoint</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-amber-500 shadow-md"></span>
            <span className="text-[11px] font-semibold text-slate-300">Départ en attente</span>
          </div>
        </div>

        <div className="text-[11px] font-mono text-slate-500 text-right">
          Technologie OSM + Leaflet activée
        </div>
      </div>
    </div>
  );
}
