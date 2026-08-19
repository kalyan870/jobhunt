// ===== JobPulse - Live Job Hunt App =====

const API_SOURCES = [
    { name: 'Jobicy', fetch: fetchJobicyJobs },
    { name: 'Remotive', fetch: fetchRemotiveJobs },
    { name: 'Arbeitnow', fetch: fetchArbeitnowJobs },
    { name: 'HackerNews', fetch: fetchHNJobs },
    { name: 'FindWorkDev', fetch: fetchFindWorkJobs },
];

let allJobs = [];
let filteredJobs = [];
let refreshInterval;
let countdownInterval;
let countdownSeconds = 300; // 5 minutes

// ===== API Fetchers =====

async function fetchJobicyJobs() {
    try {
        const urls = [
            'https://jobicy.com/api/v2/remote-jobs?count=50&geo=usa&industry=tech&tag=software',
            'https://jobicy.com/api/v2/remote-jobs?count=50&industry=tech&tag=hardware',
            'https://jobicy.com/api/v2/remote-jobs?count=50&industry=tech',
        ];
        const results = [];

        for (const url of urls) {
            const resp = await fetch(url);
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data.jobs) {
                data.jobs.forEach(job => {
                    results.push(normalizeJob({
                        id: `jobicy-${job.id}`,
                        title: job.jobTitle,
                        company: job.companyName,
                        location: job.jobGeo || 'Remote',
                        type: mapJobType(job.jobType),
                        salary: job.annualSalaryMin && job.annualSalaryMax
                            ? `$${Number(job.annualSalaryMin).toLocaleString()} - $${Number(job.annualSalaryMax).toLocaleString()}`
                            : null,
                        description: stripHtml(job.jobDescription || ''),
                        url: job.url,
                        posted: job.pubDate,
                        source: 'Jobicy',
                        category: categorizeJob(job.jobTitle, job.jobDescription),
                        remote: mapRemoteType(job.jobType),
                        tags: job.tags || [],
                        logo: job.companyLogo || null,
                    }));
                });
            }
        }
        return deduplicateByTitle(results);
    } catch (e) {
        console.warn('Jobicy API error:', e);
        return [];
    }
}

async function fetchRemotiveJobs() {
    try {
        const resp = await fetch('https://remotive.com/api/remote-jobs?limit=100');
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.jobs || []).map(job => normalizeJob({
            id: `remotive-${job.id}`,
            title: job.title,
            company: job.company_name,
            location: job.candidate_required_location || 'Worldwide',
            type: mapJobType(job.job_type),
            salary: job.salary || null,
            description: stripHtml(job.description || ''),
            url: job.url,
            posted: job.publication_date,
            source: 'Remotive',
            category: categorizeJob(job.title, job.description),
            remote: 'remote',
            tags: job.tags || [],
            logo: job.company_logo || null,
        }));
    } catch (e) {
        console.warn('Remotive API error:', e);
        return [];
    }
}

async function fetchArbeitnowJobs() {
    try {
        const resp = await fetch('https://www.arbeitnow.com/api/job-board-api?page=1');
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.data || []).slice(0, 80).map(job => normalizeJob({
            id: `arbeitnow-${job.id}`,
            title: job.title,
            company: job.company_name,
            location: job.location || 'Remote',
            type: 'full-time',
            salary: null,
            description: stripHtml(job.description || ''),
            url: job.url,
            posted: job.created_at,
            source: 'Arbeitnow',
            category: categorizeJob(job.title, job.description),
            remote: job.remote ? 'remote' : 'onsite',
            tags: job.tags || [],
            logo: job.company_logo || null,
        }));
    } catch (e) {
        console.warn('Arbeitnow API error:', e);
        return [];
    }
}

async function fetchHNJobs() {
    try {
        const resp = await fetch('https://hacker-news.firebaseio.com/v0/jobstories.json');
        if (!resp.ok) return [];
        const ids = await resp.json();
        const results = [];
        const batch = ids.slice(0, 50);

        const fetches = batch.map(async (id) => {
            try {
                const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
                return await r.json();
            } catch { return null; }
        });

        const items = await Promise.allSettled(fetches);
        items.forEach(item => {
            if (item.status !== 'fulfilled' || !item.value || !item.value.title) return;
            const job = item.value;
            if (!job.url && !job.text) return;
            results.push(normalizeJob({
                id: `hn-${job.id}`,
                title: job.title,
                company: extractCompanyFromHN(job.title),
                location: 'Remote / Varies',
                type: 'full-time',
                salary: null,
                description: stripHtml(job.text || 'View listing for details'),
                url: job.url || `https://news.ycombinator.com/item?id=${job.id}`,
                posted: new Date((job.time || 0) * 1000).toISOString(),
                source: 'Hacker News',
                category: categorizeJob(job.title, job.text || ''),
                remote: 'hybrid',
                tags: [],
                logo: null,
            }));
        });
        return results;
    } catch (e) {
        console.warn('HN Jobs API error:', e);
        return [];
    }
}

async function fetchFindWorkJobs() {
    try {
        const resp = await fetch('https://findwork.dev/api/jobs/?order_by=-date_posted&search=software+hardware');
        if (!resp.ok) return [];
        const data = await resp.json();
        return (data.results || []).map(job => normalizeJob({
            id: `findwork-${job.id}`,
            title: job.role,
            company: job.company_name,
            location: job.location || 'Remote',
            type: mapJobType(job.employment_type),
            salary: null,
            description: stripHtml(job.text || ''),
            url: job.url || job.apply_url,
            posted: job.date_posted,
            source: 'FindWork',
            category: categorizeJob(job.role, job.text || ''),
            remote: job.remote ? 'remote' : 'onsite',
            tags: job.keywords || [],
            logo: job.logo || null,
        }));
    } catch (e) {
        console.warn('FindWork API error:', e);
        return [];
    }
}

// ===== Helpers =====

function normalizeJob(raw) {
    return {
        id: raw.id || Math.random().toString(36).substr(2, 9),
        title: raw.title || 'Untitled Position',
        company: raw.company || 'Unknown Company',
        location: raw.location || 'Not specified',
        type: raw.type || 'full-time',
        salary: raw.salary || null,
        description: truncate(raw.description || '', 300),
        fullDescription: raw.description || '',
        url: raw.url || '#',
        posted: raw.posted || new Date().toISOString(),
        source: raw.source || 'Unknown',
        category: raw.category || 'software',
        remote: raw.remote || 'hybrid',
        tags: raw.tags || [],
        logo: raw.logo || null,
        isNew: isRecentJob(raw.posted),
    };
}

function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '...' : str;
}

function deduplicateByTitle(jobs) {
    const seen = new Map();
    jobs.forEach(j => {
        const key = j.title.toLowerCase().trim();
        if (!seen.has(key)) seen.set(key, j);
    });
    return Array.from(seen.values());
}

function isRecentJob(dateStr) {
    if (!dateStr) return false;
    const posted = new Date(dateStr);
    const now = new Date();
    const diff = now - posted;
    return diff < 24 * 60 * 60 * 1000; // within 24 hours
}

function mapJobType(type) {
    if (!type) return 'full-time';
    const t = type.toLowerCase();
    if (t.includes('part')) return 'part-time';
    if (t.includes('contract')) return 'contract';
    if (t.includes('freelance')) return 'freelance';
    if (t.includes('intern')) return 'internship';
    return 'full-time';
}

function mapRemoteType(type) {
    if (!type) return 'hybrid';
    const t = type.toLowerCase();
    if (t.includes('remote')) return 'remote';
    return 'remote';
}

function categorizeJob(title, desc) {
    const text = `${title} ${desc}`.toLowerCase();
    const cats = [
        { key: 'hardware', words: ['hardware', 'firmware', 'embedded', 'fpga', 'pcb', 'circuit', 'iot', 'robotics', 'chip', 'semiconductor', 'asic', 'asic', 'sensor', 'arduino', 'raspberry'] },
        { key: 'devops', words: ['devops', 'cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'ci/cd', 'infrastructure', 'terraform', 'ansible', 'sre', 'platform'] },
        { key: 'data', words: ['data', 'machine learning', 'ml', 'ai', 'artificial intelligence', 'nlp', 'deep learning', 'analytics', 'data scientist', 'data engineer', 'tensorflow', 'pytorch'] },
        { key: 'security', words: ['security', 'cyber', 'pentest', 'vulnerability', 'encryption', 'firewall', 'infosec', 'compliance', 'soc'] },
        { key: 'mobile', words: ['mobile', 'ios', 'android', 'react native', 'flutter', 'swift', 'kotlin'] },
        { key: 'design', words: ['design', 'ui/ux', 'figma', 'sketch', 'frontend', 'front-end', 'css', 'visual'] },
        { key: 'management', words: ['manager', 'lead', 'director', 'vp', 'cto', 'head of', 'principal', 'staff'] },
    ];
    for (const cat of cats) {
        if (cat.words.some(w => text.includes(w))) return cat.key;
    }
    return 'software';
}

function extractCompanyFromHN(title) {
    const patterns = [
        /(?:at|for|@)\s+(.+?)(?:\s*\(|$)/i,
        /\((.+?)\)/,
        /^([\w\s]+?)(?:\s*[-–—]|\s*$)/,
    ];
    for (const p of patterns) {
        const m = title.match(p);
        if (m && m[1] && m[1].length < 40) return m[1].trim();
    }
    return 'Various Companies';
}

function formatSalary(salary) {
    if (!salary) return '<span class="salary unknown">Not specified</span>';
    return `<span class="salary">${salary}</span>`;
}

function timeAgo(dateStr) {
    if (!dateStr) return 'Recently';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
}

function getCompanyEmoji(category) {
    const emojis = {
        software: '💻',
        hardware: '🔧',
        devops: '☁️',
        data: '📊',
        security: '🔒',
        mobile: '📱',
        design: '🎨',
        management: '📋',
    };
    return emojis[category] || '💼';
}

// ===== Rendering =====

function renderJobs(jobs) {
    const container = document.getElementById('jobsContainer');
    const noResults = document.getElementById('noResults');

    if (jobs.length === 0) {
        container.innerHTML = '';
        noResults.style.display = 'block';
        return;
    }

    noResults.style.display = 'none';

    container.innerHTML = jobs.map(job => `
        <div class="job-card ${job.isNew ? 'new-job' : ''}" onclick="openModal('${job.id.replace(/'/g, "\\'")}')">
            <div class="card-header">
                <div class="company-logo">${getCompanyEmoji(job.category)}</div>
                <div class="card-header-text">
                    <div class="job-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</div>
                    <div class="company-name">${escapeHtml(job.company)}</div>
                </div>
            </div>
            <div class="job-tags">
                <span class="tag tag-category">${job.category}</span>
                <span class="tag tag-type">${job.type.replace('-', ' ')}</span>
                <span class="tag tag-remote">${job.remote}</span>
                ${job.isNew ? '<span class="tag tag-new">🔥 NEW</span>' : ''}
            </div>
            <div class="job-description">${escapeHtml(job.description)}</div>
            <div class="card-footer">
                <div>${formatSalary(job.salary)}</div>
                <span class="posted-date">${timeAgo(job.posted)} • ${job.source}</span>
            </div>
        </div>
    `).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Modal =====

function openModal(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    const modal = document.getElementById('jobModal');
    const body = document.getElementById('modalBody');

    body.innerHTML = `
        <div class="modal-header">
            <div class="modal-logo">${getCompanyEmoji(job.category)}</div>
            <div>
                <div class="modal-title">${escapeHtml(job.title)}</div>
                <div class="modal-company">${escapeHtml(job.company)} • ${escapeHtml(job.location)}</div>
            </div>
        </div>
        <div class="modal-tags">
            <span class="tag tag-category">${job.category}</span>
            <span class="tag tag-type">${job.type.replace('-', ' ')}</span>
            <span class="tag tag-remote">${job.remote}</span>
            ${job.isNew ? '<span class="tag tag-new">🔥 NEW</span>' : ''}
        </div>
        <div class="modal-section">
            <h3>💰 Compensation</h3>
            <p>${job.salary ? escapeHtml(job.salary) : 'Not specified — ask during application'}</p>
        </div>
        <div class="modal-section">
            <h3>📝 Description</h3>
            <div style="white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: var(--text-secondary);">${escapeHtml(job.fullDescription)}</div>
        </div>
        <div class="modal-section">
            <h3>📍 Details</h3>
            <p>
                <strong>Company:</strong> ${escapeHtml(job.company)}<br>
                <strong>Location:</strong> ${escapeHtml(job.location)}<br>
                <strong>Posted:</strong> ${timeAgo(job.posted)}<br>
                <strong>Source:</strong> ${job.source}
                ${job.tags.length ? `<br><strong>Tags:</strong> ${job.tags.slice(0, 10).join(', ')}` : ''}
            </p>
        </div>
        <a class="modal-apply-btn" href="${escapeHtml(job.url)}" target="_blank" rel="noopener">
            Apply Now →
        </a>
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('jobModal').style.display = 'none';
    document.body.style.overflow = '';
}

// ===== Search & Filter =====

function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase().trim();
    const category = document.getElementById('categoryFilter').value;
    const type = document.getElementById('typeFilter').value;
    const exp = document.getElementById('expFilter').value;
    const remote = document.getElementById('remoteFilter').value;

    filteredJobs = allJobs.filter(job => {
        // Search
        if (search) {
            const searchFields = `${job.title} ${job.company} ${job.description} ${job.tags.join(' ')} ${job.location}`.toLowerCase();
            if (!searchFields.includes(search)) return false;
        }

        // Category
        if (category !== 'all' && job.category !== category) return false;

        // Type
        if (type !== 'all' && job.type !== type) return false;

        // Remote
        if (remote !== 'all' && job.remote !== remote) return false;

        // Experience (heuristic based on title)
        if (exp !== 'all') {
            const title = job.title.toLowerCase();
            const isSenior = /senior|sr\.|lead|principal|staff|head|vp|director/i.test(title);
            const isMid = /mid|intermediate|ii|2/i.test(title) || (!isSenior && /engineer|developer|specialist|analyst/i.test(title));
            const isEntry = /junior|jr\.|entry|intern|trainee|associate|graduate/i.test(title);

            if (exp === 'entry' && !isEntry) return false;
            if (exp === 'senior' && !isSenior) return false;
            if (exp === 'lead' && !(/lead|manager|director|head|vp|principal|staff|cto/i.test(title))) return false;
            if (exp === 'mid' && (isEntry || isSenior)) return false;
        }

        return true;
    });

    renderJobs(filteredJobs);
    document.getElementById('totalJobs').textContent = filteredJobs.length;
}

// ===== Fetch & Initialize =====

async function fetchJobs() {
    document.getElementById('loadingState').style.display = 'flex';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('jobsContainer').innerHTML = '';

    try {
        const results = await Promise.allSettled(
            API_SOURCES.map(src => src.fetch())
        );

        let allNewJobs = [];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                allNewJobs = allNewJobs.concat(r.value);
                console.log(`✅ ${API_SOURCES[i].name}: ${r.value.length} jobs`);
            } else {
                console.warn(`❌ ${API_SOURCES[i].name} failed:`, r.reason);
            }
        });

        allJobs = deduplicateByTitle(allNewJobs);

        // Sort by posted date
        allJobs.sort((a, b) => {
            if (a.isNew && !b.isNew) return -1;
            if (!a.isNew && b.isNew) return 1;
            return new Date(b.posted || 0) - new Date(a.posted || 0);
        });

        filteredJobs = [...allJobs];

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        applyFilters();
        resetCountdown();
    } catch (error) {
        console.error('Fetch error:', error);
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorMessage').textContent = `Failed to load jobs: ${error.message}`;
    }
}

// ===== Countdown Timer =====

function resetCountdown() {
    countdownSeconds = 300;
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        countdownSeconds--;
        const min = Math.floor(countdownSeconds / 60);
        const sec = countdownSeconds % 60;
        document.getElementById('countdown').textContent = `${min}:${sec.toString().padStart(2, '0')}`;
        if (countdownSeconds <= 0) {
            fetchJobs();
        }
    }, 1000);
}

// ===== Event Listeners =====

document.addEventListener('DOMContentLoaded', () => {
    // Search
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');

    searchInput.addEventListener('input', () => {
        clearBtn.style.display = searchInput.value ? 'block' : 'none';
        applyFilters();
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyFilters();
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        applyFilters();
    });

    document.getElementById('searchBtn').addEventListener('click', applyFilters);

    // Filters
    ['categoryFilter', 'typeFilter', 'expFilter', 'remoteFilter'].forEach(id => {
        document.getElementById(id).addEventListener('change', applyFilters);
    });

    // Modal close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Auto-refresh every 5 minutes
    refreshInterval = setInterval(fetchJobs, 5 * 60 * 1000);

    // Initial fetch
    fetchJobs();
});
