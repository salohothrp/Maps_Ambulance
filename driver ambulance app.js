// --- Konfigurasi Firebase ---
const firebaseConfig = {
    apiKey: "AIzaSyByBHDcfPHZH_yxtwEt2Mtschvse7sfxbc",
    authDomain: "ambulance-tracking-b655d.firebaseapp.com",
    databaseURL: "https://ambulance-tracking-b655d-default-rtdb.firebaseio.com",
    projectId: "ambulance-tracking-b655d",
    storageBucket: "ambulance-tracking-b655d.appspot.com",
    messagingSenderId: "161818146577",
    appId: "1:161818146577:web:6a2950b4ce8d187af97eb0",
    measurementId: "G-R73WETR34W"
};

// --- Variabel Global ---
let db, driverMap, driverMarker, tripId, routeControl;
let currentStatus = 1;
let pickupCoords = null;
let destinationCoords = null;
const ARRIVAL_THRESHOLD_METERS = 50;

// --- Variabel Baru untuk Simulasi ---
let simulationInterval = null;
let simulationIndex = 0;

// --- Fungsi Inisialisasi Utama ---
function initializeApp() {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    tripId = new URLSearchParams(window.location.search).get("tripId");

    driverMap = L.map('driverMap').setView([3.595, 98.672], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(driverMap);
    driverMarker = L.marker([3.595, 98.672], {
        icon: L.icon({ iconUrl: 'Ambulance Edwin.png', iconSize: [38, 38] })
    }).addTo(driverMap).bindPopup("Posisi Ambulans").openPopup();

    if (!tripId) {
        document.getElementById('missionContent').innerHTML = "<div class='mission-summary'><p>Tidak ada misi aktif.</p></div>";
        return;
    }
    loadMissionDetails(tripId);
    startLocationTracking();
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    updateConnectionStatus();
}

// --- Fungsi untuk Memuat Detail Misi ---
function loadMissionDetails(currentTripId) {
    const missionRef = db.ref('trips/' + currentTripId);
    missionRef.on('value', (snapshot) => {
        const tripData = snapshot.val();
        if (tripData) {
            const { pemohon, telepon, perihal, alamatJemput, alamatTujuan, coordsJemput, coordsTujuan } = tripData;
            const missionContent = document.getElementById('missionContent');
            missionContent.innerHTML = `
                <div class="mission-summary">
                    <div class="summary-item"><strong>Perihal:</strong> ${perihal || 'N/A'}</div>
                    <div class="summary-item"><strong>Pemohon:</strong> ${pemohon}</div>
                    <div class="summary-item"><strong>Telepon:</strong> <a href="tel:${telepon}">${telepon}</a></div>
                </div>
                <div class="mission-full-details" id="missionFullDetails">
                    <div class="details-content">
                        <div class="detail-item"><strong>📌 Alamat Jemput:</strong><span>${alamatJemput}</span></div>
                        <div class="detail-item"><strong>🏁 Alamat Tujuan:</strong><span>${alamatTujuan}</span></div>
                    </div>
                </div>`;
            pickupCoords = coordsJemput;
            destinationCoords = coordsTujuan;
            createInitialRoute(coordsJemput, coordsTujuan);
        }
    });
}

// --- Fungsi Format Tampilan ---
function formatDistance(meters) { return meters < 1000 ? `${meters.toFixed(0)} m` : `${(meters / 1000).toFixed(1)} km`; }
function formatTime(seconds) { const minutes = Math.round(seconds / 60); if (minutes < 60) { return `${minutes} mnt`; } const hours = Math.floor(minutes / 60); return `${hours} jam ${minutes % 60} mnt`; }

// --- Fungsi untuk Membuat Rute Awal ---
function createInitialRoute(start, end) {
    if (routeControl) driverMap.removeControl(routeControl);
    routeControl = L.Routing.control({
        waypoints: [ L.latLng(start.lat, start.lng), L.latLng(end.lat, end.lng) ],
        routeWhileDragging: false, addWaypoints: false,
        lineOptions: { styles: [{color: 'blue', opacity: 0.8, weight: 6}] },
    }).addTo(driverMap);

    routeControl.on('routesfound', (e) => {
        const el = document.querySelector('.leaflet-routing-container');
        if (el) el.style.display = 'none';
        const summary = e.routes[0].summary;
        document.getElementById('tripTime').textContent = formatTime(summary.totalTime);
        document.getElementById('tripDistance').textContent = formatDistance(summary.totalDistance);
        document.getElementById('tripSummary').style.display = 'flex';
    });
}

// --- Logika Inti & Rute Ulang ---

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180; const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function checkArrival(driverLat, driverLng) {
    if (currentStatus === 1 && pickupCoords) { if (calculateDistance(driverLat, driverLng, pickupCoords.lat, pickupCoords.lng) < ARRIVAL_THRESHOLD_METERS) { selectStatus(2); } }
    else if (currentStatus === 3 && destinationCoords) { if (calculateDistance(driverLat, driverLng, destinationCoords.lat, destinationCoords.lng) < ARRIVAL_THRESHOLD_METERS) { selectStatus(4); } }
}

function updateDynamicRoute(driverLat, driverLng) {
    if (!routeControl) return;
    let targetCoords;
    if (currentStatus === 1) { targetCoords = pickupCoords; }
    else if (currentStatus === 3) { targetCoords = destinationCoords; }
    else { document.getElementById('tripSummary').style.display = 'none'; return; }
    if (!targetCoords) return;
    routeControl.setWaypoints([ L.latLng(driverLat, driverLng), L.latLng(targetCoords.lat, targetCoords.lng) ]);
}

// --- FUNGSI BARU: MEMPROSES POSISI BARU (DARI GPS ASLI ATAU SIMULASI) ---
function processNewPosition(latitude, longitude, accuracy) {
    // 1. Perbarui posisi marker di peta
    driverMarker.setLatLng([latitude, longitude]);
    driverMap.panTo([latitude, longitude]); // Otomatis tengahkan peta
    document.getElementById('currentLat').textContent = latitude.toFixed(6);
    document.getElementById('currentLng').textContent = longitude.toFixed(6);
    document.getElementById('accuracy').textContent = `GPS: ${accuracy.toFixed(0)}m`;

    // 2. Periksa apakah sudah tiba
    checkArrival(latitude, longitude);

    // 3. Lakukan rute ulang otomatis
    updateDynamicRoute(latitude, longitude);
    
    // 4. Kirim update ke Firebase
    sendLocationUpdate(latitude, longitude);
}

// --- Fungsi Pelacakan Lokasi (Diperbarui) ---
function startLocationTracking() {
    updateLocation();
    setInterval(updateLocation, 10000); // Dapatkan lokasi GPS asli setiap 10 detik
}

function updateLocation() {
    // Jangan gunakan GPS asli jika simulasi sedang berjalan
    if (simulationInterval) return; 

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            processNewPosition(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
        }, () => showNotification('Gagal mendapatkan lokasi GPS.', 'error'), 
           { enableHighAccuracy: true });
    }
}

// --- FUNGSI BARU: SIMULASI PERGERAKAN ---
function startSimulation() {
    const simBtn = document.getElementById('simBtn');

    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        simBtn.innerHTML = '▶️ Mulai Simulasi';
        simBtn.classList.remove('btn-danger');
        simBtn.classList.add('btn-primary');
        showNotification('Simulasi dihentikan.', 'success');
        return;
    }

    if (!routeControl || !routeControl.getRouter()._routes || routeControl.getRouter()._routes.length === 0) {
        showNotification('Tidak ada rute untuk disimulasikan.', 'error');
        return;
    }

    const routeCoordinates = routeControl.getRouter()._routes[0].coordinates;
    if (!routeCoordinates || routeCoordinates.length === 0) { return; }

    simulationIndex = 0;
    simBtn.innerHTML = '⏹️ Hentikan Simulasi';
    simBtn.classList.remove('btn-primary');
    simBtn.classList.add('btn-danger');
    showNotification('Simulasi dimulai...', 'success');

    simulationInterval = setInterval(() => {
        if (simulationIndex >= routeCoordinates.length) {
            clearInterval(simulationInterval);
            simulationInterval = null;
            simBtn.innerHTML = '▶️ Mulai Simulasi';
            simBtn.classList.remove('btn-danger');
            simBtn.classList.add('btn-primary');
            showNotification('Simulasi selesai.', 'success');
            return;
        }

        const currentCoord = routeCoordinates[simulationIndex];
        processNewPosition(currentCoord.lat, currentCoord.lng, 10); // Akurasi 10m untuk simulasi

        simulationIndex += 5; // Lompat 5 titik setiap interval untuk simulasi lebih cepat

    }, 500); // Update setiap 0.5 detik
}

// --- Fungsi Aksi UI ---
function selectStatus(statusId) {
    if (statusId < currentStatus && currentStatus !== 4) return;
    currentStatus = statusId;
    
    document.querySelectorAll('.status-card').forEach(card => {
        card.classList.remove('active', 'completed');
        const cardStatus = parseInt(card.getAttribute('data-status'));
        if (cardStatus < currentStatus) card.classList.add('completed');
    });
    
    const activeCard = document.querySelector(`[data-status="${statusId}"]`);
    activeCard.classList.add('active');
    showNotification(`Status diperbarui: ${activeCard.querySelector('.status-text').textContent}`, 'success');
}

function sendLocationUpdate(lat, lng) {
    if (!tripId) return;
    const statusText = document.querySelector(`.status-card[data-status="${currentStatus}"] .status-text`).textContent;
    db.ref('tracking/' + tripId).set({ lat, lng, status: statusText, timestamp: new Date().toISOString() });
}

// --- Fungsi Utilitas Lainnya ---
function toggleMissionDetails(){const e=document.querySelector(".mission-header"),t=document.getElementById("missionFullDetails");t&&(e.classList.toggle("active"),t.style.maxHeight?t.style.maxHeight=null:t.style.maxHeight=t.scrollHeight+"px")}
function sendEmergency(){confirm("🚨 Kirim sinyal darurat?")&&(db.ref("emergencies/"+tripId).set({message:"Driver darurat!",timestamp:(new Date).toISOString()}),showNotification("🚨 Sinyal darurat terkirim!","error"))}
function endTrip(){if(confirm("🛑 Akhiri perjalanan ini?")){db.ref("trips/"+tripId).update({status:"Selesai",endTime:(new Date).toISOString()}),db.ref("tracking/"+tripId).remove(),showNotification("✅ Perjalanan berhasil diakhiri.","success"),setTimeout(()=>{window.close()},3e3)}}
function showNotification(e,t="success"){const o=document.getElementById("notification");o.textContent=e,o.className=`notification show ${t}`,setTimeout(()=>{o.classList.remove("show")},3e3)}
function updateConnectionStatus(){document.getElementById("offlineIndicator").style.display=navigator.onLine?"none":"block"}

// --- Titik Masuk Aplikasi ---
window.onload = initializeApp;
