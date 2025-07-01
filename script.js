// Konfigurasi Firebase
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
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- Variabel Global untuk Peta & Lokasi ---
let mapJemput, mapTujuan, markerJemput, markerTujuan;
const selectedLocation = {
    jemput: null,
    tujuan: null
};

// --- Inisialisasi Peta & Pencarian ---
document.addEventListener('DOMContentLoaded', function() {
    // Set tanggal hari ini secara default
    document.getElementById('tanggalPermintaan').valueAsDate = new Date();
    
    // Inisialisasi Peta Jemput
    mapJemput = L.map('mapJemput').setView([3.595, 98.672], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapJemput);
    markerJemput = L.marker([3.595, 98.672]).addTo(mapJemput).bindPopup("Pilih lokasi jemput.").openPopup();

    // Inisialisasi Peta Tujuan
    mapTujuan = L.map('mapTujuan').setView([3.595, 98.672], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapTujuan);
    markerTujuan = L.marker([3.595, 98.672]).addTo(mapTujuan).bindPopup("Pilih lokasi tujuan.").openPopup();

    const searchProvider = new GeoSearch.OpenStreetMapProvider();

    // Fungsi untuk menangani hasil pencarian peta
    const handleSearchResult = (result, type) => {
        const { x, y, label } = result.location; // x: lng, y: lat
        const map = (type === 'jemput') ? mapJemput : mapTujuan;
        const marker = (type === 'jemput') ? markerJemput : markerTujuan;
        const inputId = (type === 'jemput') ? 'alamatJemput' : 'alamatTujuan';
        
        // Simpan lokasi yang dipilih beserta koordinatnya
        selectedLocation[type] = { label: label, coords: { lat: y, lng: x } };
        
        document.getElementById(inputId).value = label;
        const newLatLng = new L.LatLng(y, x);
        marker.setLatLng(newLatLng).setPopupContent(label).openPopup();
        map.setView(newLatLng, 16);
    };

    // Kontrol Pencarian untuk Peta Jemput
    const searchControlJemput = new GeoSearch.GeoSearchControl({
        provider: searchProvider,
        style: 'bar',
        showMarker: false,
        autoClose: true,
        searchLabel: 'Cari alamat jemput...'
    });
    mapJemput.addControl(searchControlJemput);
    mapJemput.on('geosearch/showlocation', (result) => handleSearchResult(result, 'jemput'));

    // Kontrol Pencarian untuk Peta Tujuan
    const searchControlTujuan = new GeoSearch.GeoSearchControl({
        provider: searchProvider,
        style: 'bar',
        showMarker: false,
        autoClose: true,
        searchLabel: 'Cari alamat tujuan...'
    });
    mapTujuan.addControl(searchControlTujuan);
    mapTujuan.on('geosearch/showlocation', (result) => handleSearchResult(result, 'tujuan'));
});

// --- Logika Pengiriman Formulir ---
document.getElementById('ambulanceForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    // Validasi: Pastikan lokasi jemput dan tujuan sudah dipilih di peta
    if (!selectedLocation.jemput || !selectedLocation.tujuan) {
        showNotification("Harap pilih Alamat Jemput dan Tujuan dari peta.", "error");
        return;
    }

    const form = this;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    document.getElementById('submitText').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';

    const formData = new FormData(form);
    const tripId = 'TRIP_' + Date.now(); // ID unik untuk setiap perjalanan

    try {
        // PERBAIKAN: Langsung gunakan koordinat dari `selectedLocation`
        // Tidak perlu memanggil getCoordinates lagi, karena sudah didapat dari peta.
        // Ini lebih cepat dan menghindari potensi error geocoding.
        const coordsJemput = selectedLocation.jemput.coords;
        const coordsTujuan = selectedLocation.tujuan.coords;

        // Data yang akan disimpan ke Firebase
        const tripData = {
            id: tripId,
            pemohon: formData.get('nama'),
            telepon: formData.get('telepon'),
            perihal: formData.get('perihal'), // Menambahkan perihal
            alamatJemput: selectedLocation.jemput.label,
            alamatTujuan: selectedLocation.tujuan.label,
            coordsJemput: { lat: coordsJemput.lat, lng: coordsJemput.lng },
            coordsTujuan: { lat: coordsTujuan.lat, lng: coordsTujuan.lng },
            status: 'Menunggu Konfirmasi', // Status awal
            timestamp: new Date().toISOString()
        };

        // Menyimpan data perjalanan ke Firebase Realtime Database
        await db.ref('trips/' + tripId).set(tripData);
        console.log("Data perjalanan berhasil disimpan ke Firebase dengan ID:", tripId);

        // Buka aplikasi driver di tab baru dengan tripId sebagai parameter
        window.open(`driver ambulance app.html?tripId=${tripId}`, '_blank');
        
        // Melanjutkan proses pengiriman ke Google Script
        const responseGoogleScript = await fetch(form.action, { method: 'POST', body: formData });
        if (!responseGoogleScript.ok) throw new Error(`Error Google Script: status ${responseGoogleScript.status}`);
        
        const resultGoogleScript = await responseGoogleScript.json();
        if (resultGoogleScript.status === 'success') {
            showNotification('Permintaan berhasil! Aplikasi driver telah dibuka.', 'success');
            updateHistory(Object.fromEntries(formData));
            resetForm();
            
            // Logika WhatsApp (opsional, bisa disesuaikan)
            if (resultGoogleScript.pdfUrl) {
                const pesanWA = `*PEMBERITAHUAN LAYANAN AMBULANCE*\n\nTim RAESN telah menerima permintaan layanan Ambulance.\n\n*Nama Pemohon:* ${formData.get('nama')}\n*Nomor Surat:* ${resultGoogleScript.nomorSurat}\n*Link PDF:* ${resultGoogleScript.pdfUrl}\n\nSegera koordinasikan dengan driver.\n\nTerima kasih.\n*Tim Ambulance Rumah Aspirasi*`;
                const waLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(pesanWA)}`;
                window.open(waLink, '_blank');
            }
        } else {
            throw new Error(resultGoogleScript.message || 'Terjadi kesalahan pada server Google Script.');
        }

    } catch (error) {
        console.error('Submission Error:', error);
        showNotification('Gagal memproses permintaan. Detail: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        document.getElementById('submitText').style.display = 'inline';
        document.getElementById('loading').style.display = 'none';
    }
});


// --- Fungsi utilitas ---
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification show ${type}`; // Menggunakan class untuk styling
    setTimeout(() => {
        notification.classList.remove('show');
    }, 5000);
}

function resetForm() {
    const form = document.getElementById('ambulanceForm');
    form.reset();
    document.getElementById('tanggalPermintaan').valueAsDate = new Date();
    document.getElementById('nama').focus();
    
    // Reset peta dan lokasi yang tersimpan
    mapJemput.setView([3.595, 98.672], 13);
    markerJemput.setLatLng([3.595, 98.672]).setPopupContent("Pilih lokasi jemput.");
    mapTujuan.setView([3.595, 98.672], 13);
    markerTujuan.setLatLng([3.595, 98.672]).setPopupContent("Pilih lokasi tujuan.");
    
    selectedLocation.jemput = null;
    selectedLocation.tujuan = null;

    document.getElementById('alamatJemput').value = '';
    document.getElementById('alamatTujuan').value = '';
}

let requestHistory = [];
function updateHistory(requestData) {
    if (!requestData) return;
    requestData.timestamp = new Date().toISOString();
    requestHistory.unshift(requestData);
    const container = document.getElementById('historyContainer');
    if (requestHistory.length === 0) {
        container.innerHTML = '<div class="empty-history">Belum ada permintaan yang dikirim hari ini</div>';
        return;
    }
    const historyHTML = requestHistory.map((request) => {
        const date = new Date(request.timestamp);
        const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        return `<div class="history-item"><h4>${request.nama}</h4><p><strong>Waktu Kirim:</strong> ${timeStr}</p><p><strong>Tujuan:</strong> ${request.alamatTujuan}</p></div>`;
    }).join('');
    container.innerHTML = historyHTML;
}

document.getElementById('telepon').addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 0 && !value.startsWith('0')) {
        value = '0' + value;
    }
    e.target.value = value;
});
