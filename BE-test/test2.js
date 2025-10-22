/**
 * Direction:
 * Remove duplicated data from array
 * 
 * Expected Result:
 * [1, 2, 3, 4, 5]
 */
const data = [1, 4, 2, 3, 5, 3, 2, 4];

function result(data) {
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      if (data[i] === data[j]) {
        data.splice(j, 1);
        j--;
      }
    }
  }

  for (let i = 0; i < data.length - 1; i++) {
    for (let j = i + 1; j < data.length; j++) {
      if (data[i] > data[j]) {
        const temp = data[i];
        data[i] = data[j];
        data[j] = temp;
      }
    }
  }

  return data;
}

console.log(result(data));
