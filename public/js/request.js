/**
 * request.js
 * Handles blood request submission and persistence using API.
 */

const API_REQ_URL = window.location.origin + '/api';

class RequestManager {
    async addRequest(request) {
        // Map to snake_case for DB
        const payload = {
            patient_name: request.patientName,
            blood_group: request.bloodGroup,
            units: request.unit,
            hospital: request.hospital,
            phone: request.phone,
            needed_date: request.neededDate
        };

        try {
            const response = await fetch(`${API_REQ_URL}/requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            return await response.json();
        } catch (error) {
            console.error('Error adding request:', error);
            throw error;
        }
    }

    async getAllRequests() {
        try {
            const response = await fetch(`${API_REQ_URL}/requests?limit=100`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || 'Failed to fetch requests');
            const requests = Array.isArray(result) ? result : result.data;
            if (!Array.isArray(requests)) throw new Error('Unexpected requests response');

            return requests.map(r => ({
                id: r.id,
                patientName: r.patient_name,
                bloodGroup: r.blood_group,
                unit: r.units,
                hospital: r.hospital,
                requestDate: r.created_at,
                neededDate: r.needed_date, // Check format! Date might need formatting
                phone: r.phone
            }));
        } catch (error) {
            console.error('Error fetching requests:', error);
            return [];
        }
    }

    async deleteRequest(id) {
        try {
            const headers = window.getAuthHeaders ? window.getAuthHeaders() : {};
            await fetch(`${API_REQ_URL}/requests/${id}`, {
                method: 'DELETE',
                headers: headers
            });
            return true;
        } catch (error) {
            console.error('Error deleting request:', error);
            return false;
        }
    }
}

const requestManager = new RequestManager();

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('request-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const request = {
                patientName: document.getElementById('patient-name').value,
                bloodGroup: document.getElementById('blood-group').value,
                unit: document.getElementById('unit').value,
                hospital: document.getElementById('hospital').value,
                phone: document.getElementById('phone').value,
                neededDate: document.getElementById('needed-date').value
            };

            try {
                await requestManager.addRequest(request);
                alert('Your request has been posted successfully!');
                form.reset();
                window.location.href = 'index.html';
            } catch (err) {
                alert('Failed to post request.');
            }
        });
    }
});
