/**
 * Direction:
 * Remove key that have null or undefined value
 *
 * Expected Result:
 * [
 *   { session_name: 'first test', classes: [{ students: [{ student_name: 'budi' }] }] },
 *   { classes: [{ class_name: 'second class', students: [{ student_name: 'adi' }] }] },
 * ]
 */
const data = [
  { session_name: 'first test', classes: [{ class_name: undefined, students: [{ student_name: 'budi' }] }] },
  { session_name: null, classes: [{ class_name: 'second class', students: [{ student_name: 'adi' }] }] },
];

function result(data) {
  for (let i = 0; i < data.length; i++) {
    const session = data[i];  
    if (session.session_name === null || session.session_name === undefined) {
      delete session.session_name;
    }
    for (let j = 0; j < session.classes.length; j++) {
      const classItem = session.classes[j];
      if (classItem.class_name === null || classItem.class_name === undefined) {
        delete classItem.class_name;
      }
    }
  }
  return data;
}

console.log(result(data));
