import { execSync } from 'node:child_process';
import { database, transaction, closeDatabase } from '../lib/postgres.mjs';
import { createHash } from 'node:crypto';

const GDRIVE_CMD = 'C:\\Users\\ku900539\\.gemini\\config\\plugins\\gdrive\\skills\\gdrive\\scripts\\gdrive.cmd';

function gdriveList(folderId) {
  try {
    const raw = execSync(`"${GDRIVE_CMD}" readonly ls "${folderId}"`, { encoding: 'utf8' });
    const lines = raw.trim().split('\n');
    const items = [];
    let headerPassed = false;
    for (const line of lines) {
      if (line.startsWith('---')) { headerPassed = true; continue; }
      if (!headerPassed) continue;
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length >= 3) {
        items.push({
          id: parts[0].trim(),
          name: parts[1].trim(),
          type: parts[2].trim(),
          size: parts[3] ? parts[3].trim() : ''
        });
      }
    }
    return items;
  } catch (err) {
    console.error(`Failed to list folder ${folderId}:`, err.message);
    return [];
  }
}

async function syncDriveMaterials() {
  const rootLearningMaterialsId = '1Kvbec9B0_p_izokdFBQn2bijEj-r_tpw';
  const studentFolders = gdriveList(rootLearningMaterialsId);
  console.log('Found student folders:', studentFolders.map(f => f.name));

  const allFiles = [];

  for (const sf of studentFolders) {
    let studentId = '';
    if (sf.name.includes('Izan')) studentId = 'izan';
    else if (sf.name.includes('Zeidin')) studentId = 'zeidin';
    else continue;

    console.log(`Scanning materials for student: ${studentId} (${sf.name})...`);
    const subjectFolders = gdriveList(sf.id);

    for (const sub of subjectFolders) {
      if (sub.type !== 'folder') continue;
      const subName = sub.name;
      // Explore subfolders (like 'School Materials', 'Textbook & Notes', or direct files)
      const subItems = gdriveList(sub.id);
      for (const item of subItems) {
        if (item.type === 'folder') {
          const nestedItems = gdriveList(item.id);
          for (const nested of nestedItems) {
            if (nested.type !== 'folder') {
              allFiles.push({
                studentId,
                subject: subName,
                folderContext: item.name,
                file: nested
              });
            }
          }
        } else {
          allFiles.push({
            studentId,
            subject: subName,
            folderContext: 'Root',
            file: item
          });
        }
      }
    }
  }

  console.log(`Discovered ${allFiles.length} files across all subjects.`);

  // Load existing curriculum to map where possible
  const curriculumRes = await database().query('select id, grade, subject, lesson_name from public.curriculum');
  const curriculum = curriculumRes.rows;

  const recordsToInsert = [];

  for (const f of allFiles) {
    // Normalise subject name
    let subj = f.subject.trim();
    if (subj.toUpperCase() === 'ENGLISH') subj = 'English';
    else if (subj.toUpperCase() === 'ARABIC') subj = 'Arabic';
    else if (subj.toUpperCase() === 'MATHEMATICS') subj = 'Mathematics';
    else if (subj.toUpperCase() === 'CHEMISTRY') subj = 'Chemistry';
    else if (subj.toUpperCase() === 'BIOLOGY') subj = 'Biology';
    else if (subj.toUpperCase() === 'PHYSICS') subj = 'Physics';
    else if (subj.toUpperCase() === 'FRENCH') subj = 'French';
    else if (subj.toUpperCase() === 'ENVIRONMENTAL SCIENCE' || subj.toUpperCase() === 'EVS') subj = 'EVS';
    else if (subj.toUpperCase() === 'HINDI') subj = 'Hindi';
    else if (subj.toUpperCase() === 'ISLAMIC STUDIES') subj = 'Islamic Studies';

    // Find best match lesson if any
    const grade = f.studentId === 'izan' ? 'Grade 8' : 'Grade 1';
    const candidateLessons = curriculum.filter(c => c.grade === grade && c.subject.toLowerCase() === subj.toLowerCase());
    
    let matchedLesson = candidateLessons.find(c => f.file.name.toLowerCase().includes(c.lesson_name.toLowerCase()));
    
    const matId = 'gdrive-' + f.studentId + '-' + f.file.id;
    const rec = {
      id: matId,
      student_id: f.studentId,
      drive_file_id: f.file.id,
      title: f.file.name,
      subject: subj,
      assessment: 'PT2',
      lesson_name: matchedLesson ? matchedLesson.lesson_name : '',
      lesson_id: matchedLesson ? matchedLesson.id : null,
      summary: `Google Drive file from ${f.subject} (${f.folderContext})`,
      extracted_text: '',
      material_type: f.file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document',
      processing_status: 'ready',
      extraction_note: 'Indexed from Google Drive AI Tutor MVP folder',
      created_at: new Date().toISOString()
    };
    recordsToInsert.push(rec);
  }

  console.log(`Writing ${recordsToInsert.length} material records into database...`);

  await transaction(async client => {
    for (const r of recordsToInsert) {
      await client.query(`
        insert into public.materials (
          id, student_id, drive_file_id, title, subject, assessment, lesson_name, lesson_id,
          summary, extracted_text, material_type, processing_status, extraction_note, created_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        on conflict (id) do update set
          drive_file_id = excluded.drive_file_id,
          title = excluded.title,
          subject = excluded.subject,
          lesson_name = excluded.lesson_name,
          lesson_id = excluded.lesson_id,
          summary = excluded.summary,
          processing_status = excluded.processing_status
      `, [
        r.id, r.student_id, r.drive_file_id, r.title, r.subject, r.assessment, r.lesson_name, r.lesson_id,
        r.summary, r.extracted_text, r.material_type, r.processing_status, r.extraction_note, r.created_at
      ]);
    }
  });

  const countRes = await database().query('select count(*) as total, count(drive_file_id) as gdrive_count from public.materials');
  console.log('SUCCESS: Materials table sync complete!', countRes.rows[0]);

  await closeDatabase();
}

syncDriveMaterials().catch(err => {
  console.error('SYNC FAILED:', err);
  process.exit(1);
});

