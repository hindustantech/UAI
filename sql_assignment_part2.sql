-- ============================================
-- SQL Assignment — Part 2
-- Create Tables, Insert Data, Answer Questions
-- ============================================

-- ============================================
-- 1. CREATE TABLES
-- ============================================

DROP TABLE IF EXISTS takes;
DROP TABLE IF EXISTS teaches;
DROP TABLE IF EXISTS section;
DROP TABLE IF EXISTS student;
DROP TABLE IF EXISTS course;
DROP TABLE IF EXISTS instructor;
DROP TABLE IF EXISTS department;
DROP TABLE IF EXISTS emp_super;

CREATE TABLE department (
    dept_name VARCHAR(50) PRIMARY KEY,
    building VARCHAR(50),
    budget INT
);

CREATE TABLE instructor (
    ID INT PRIMARY KEY,
    name VARCHAR(50),
    dept_name VARCHAR(50),
    salary DECIMAL(10,2),
    FOREIGN KEY (dept_name) REFERENCES department(dept_name)
);

CREATE TABLE course (
    course_id VARCHAR(10) PRIMARY KEY,
    title VARCHAR(100),
    dept_name VARCHAR(50),
    credits INT,
    FOREIGN KEY (dept_name) REFERENCES department(dept_name)
);

CREATE TABLE section (
    course_id VARCHAR(10),
    sec_id INT,
    semester VARCHAR(20),
    year INT,
    building VARCHAR(50),
    room_number VARCHAR(20),
    PRIMARY KEY (course_id, sec_id, semester, year),
    FOREIGN KEY (course_id) REFERENCES course(course_id)
);

CREATE TABLE teaches (
    ID INT,
    course_id VARCHAR(10),
    sec_id INT,
    semester VARCHAR(20),
    year INT,
    PRIMARY KEY (ID, course_id, sec_id, semester, year),
    FOREIGN KEY (ID) REFERENCES instructor(ID),
    FOREIGN KEY (course_id, sec_id, semester, year) REFERENCES section(course_id, sec_id, semester, year)
);

CREATE TABLE student (
    ID INT PRIMARY KEY,
    name VARCHAR(50),
    dept_name VARCHAR(50),
    tot_cred INT,
    FOREIGN KEY (dept_name) REFERENCES department(dept_name)
);

CREATE TABLE takes (
    ID INT,
    course_id VARCHAR(10),
    sec_id INT,
    semester VARCHAR(20),
    year INT,
    grade VARCHAR(5),
    PRIMARY KEY (ID, course_id, sec_id, semester, year),
    FOREIGN KEY (ID) REFERENCES student(ID),
    FOREIGN KEY (course_id, sec_id, semester, year) REFERENCES section(course_id, sec_id, semester, year)
);

CREATE TABLE emp_super (
    Emp VARCHAR(50),
    super VARCHAR(50)
);

-- ============================================
-- 2. INSERT DATA
-- ============================================

-- department
INSERT INTO department VALUES ('Biology', 'Watson', 90000);
INSERT INTO department VALUES ('Comp. Sci.', 'Taylor', 100000);
INSERT INTO department VALUES ('Elec. Eng.', 'Taylor', 85000);
INSERT INTO department VALUES ('Finance', 'Painter', 120000);
INSERT INTO department VALUES ('History', 'Painter', 50000);
INSERT INTO department VALUES ('Music', 'Packard', 80000);
INSERT INTO department VALUES ('Physics', 'Watson', 70000);

-- instructor
INSERT INTO instructor VALUES (10101, 'Srinivasan', 'Comp. Sci.', 65000);
INSERT INTO instructor VALUES (12121, 'Wu', 'Finance', 90000);
INSERT INTO instructor VALUES (15151, 'Mozart', 'Music', 40000);
INSERT INTO instructor VALUES (22222, 'Einstein', 'Physics', 95000);
INSERT INTO instructor VALUES (32343, 'El Said', 'History', 60000);
INSERT INTO instructor VALUES (33456, 'Gold', 'Physics', 87000);
INSERT INTO instructor VALUES (45565, 'Katz', 'Comp. Sci.', 75000);
INSERT INTO instructor VALUES (58583, 'Califieri', 'History', 62000);
INSERT INTO instructor VALUES (76543, 'Singh', 'Finance', 80000);
INSERT INTO instructor VALUES (76766, 'Crick', 'Biology', 72000);
INSERT INTO instructor VALUES (83821, 'Brandt', 'Comp. Sci.', 92000);
INSERT INTO instructor VALUES (98345, 'Kim', 'Elec. Eng.', 80000);
INSERT INTO instructor VALUES (99999, 'Newton', 'Physics', NULL);

-- course
INSERT INTO course VALUES ('BIO-101', 'Intro. to Biology', 'Biology', 4);
INSERT INTO course VALUES ('BIO-301', 'Genetics', 'Biology', 4);
INSERT INTO course VALUES ('BIO-399', 'Computational Biology', 'Biology', 3);
INSERT INTO course VALUES ('CS-101', 'Intro. to Computer Science', 'Comp. Sci.', 4);
INSERT INTO course VALUES ('CS-190', 'Game Design', 'Comp. Sci.', 4);
INSERT INTO course VALUES ('CS-315', 'Robotics', 'Comp. Sci.', 3);
INSERT INTO course VALUES ('CS-319', 'Image Processing', 'Comp. Sci.', 3);
INSERT INTO course VALUES ('CS-347', 'Database System Concepts', 'Comp. Sci.', 3);
INSERT INTO course VALUES ('EE-181', 'Intro. to Digital Systems', 'Elec. Eng.', 3);
INSERT INTO course VALUES ('FIN-201', 'Investment Banking', 'Finance', 3);
INSERT INTO course VALUES ('HIS-351', 'World History', 'History', 3);
INSERT INTO course VALUES ('MU-199', 'Music Video Production', 'Music', 3);
INSERT INTO course VALUES ('PHY-101', 'Physical Principles', 'Physics', 4);

-- section
INSERT INTO section VALUES ('BIO-101', 1, 'Summer', 2017, 'Painter', '514');
INSERT INTO section VALUES ('BIO-301', 1, 'Summer', 2018, 'Painter', '514');
INSERT INTO section VALUES ('CS-101', 1, 'Fall', 2017, 'Packard', '101');
INSERT INTO section VALUES ('CS-101', 1, 'Spring', 2018, 'Packard', '101');
INSERT INTO section VALUES ('CS-190', 1, 'Spring', 2017, 'Taylor', '3128');
INSERT INTO section VALUES ('CS-190', 2, 'Spring', 2017, 'Taylor', '3128');
INSERT INTO section VALUES ('CS-315', 1, 'Spring', 2018, 'Watson', '120');
INSERT INTO section VALUES ('CS-319', 1, 'Spring', 2018, 'Watson', '100');
INSERT INTO section VALUES ('CS-319', 2, 'Spring', 2018, 'Taylor', '3128');
INSERT INTO section VALUES ('CS-347', 1, 'Fall', 2017, 'Taylor', '3128');
INSERT INTO section VALUES ('EE-181', 1, 'Spring', 2017, 'Taylor', '3128');
INSERT INTO section VALUES ('FIN-201', 1, 'Spring', 2018, 'Painter', '514');
INSERT INTO section VALUES ('HIS-351', 1, 'Spring', 2018, 'Painter', '514');
INSERT INTO section VALUES ('MU-199', 1, 'Spring', 2018, 'Packard', '101');
INSERT INTO section VALUES ('PHY-101', 1, 'Fall', 2017, 'Watson', '100');

-- teaches
INSERT INTO teaches VALUES (10101, 'CS-101', 1, 'Fall', 2017);
INSERT INTO teaches VALUES (10101, 'CS-315', 1, 'Spring', 2018);
INSERT INTO teaches VALUES (10101, 'CS-347', 1, 'Fall', 2017);
INSERT INTO teaches VALUES (12121, 'FIN-201', 1, 'Spring', 2018);
INSERT INTO teaches VALUES (15151, 'MU-199', 1, 'Spring', 2018);
INSERT INTO teaches VALUES (22222, 'PHY-101', 1, 'Fall', 2017);
INSERT INTO teaches VALUES (32343, 'HIS-351', 1, 'Spring', 2018);
INSERT INTO teaches VALUES (45565, 'CS-101', 1, 'Spring', 2018);
INSERT INTO teaches VALUES (45565, 'CS-319', 1, 'Spring', 2018);
INSERT INTO teaches VALUES (76766, 'BIO-101', 1, 'Summer', 2017);
INSERT INTO teaches VALUES (76766, 'BIO-301', 1, 'Summer', 2018);
INSERT INTO teaches VALUES (83821, 'CS-190', 1, 'Spring', 2017);
INSERT INTO teaches VALUES (83821, 'CS-190', 2, 'Spring', 2017);
INSERT INTO teaches VALUES (83821, 'CS-319', 2, 'Spring', 2018);
INSERT INTO teaches VALUES (98345, 'EE-181', 1, 'Spring', 2017);

-- student
INSERT INTO student VALUES (00128, 'Zhang', 'Comp. Sci.', 102);
INSERT INTO student VALUES (12345, 'Shankar', 'Comp. Sci.', 32);
INSERT INTO student VALUES (19991, 'Brandt', 'History', 80);
INSERT INTO student VALUES (23121, 'Chavez', 'Finance', 110);
INSERT INTO student VALUES (44553, 'Peltier', 'Physics', 56);
INSERT INTO student VALUES (45678, 'Levy', 'Physics', 46);
INSERT INTO student VALUES (54321, 'Williams', 'Comp. Sci.', 54);
INSERT INTO student VALUES (55739, 'Sanchez', 'Music', 38);
INSERT INTO student VALUES (70557, 'Snow', 'Physics', 0);
INSERT INTO student VALUES (76543, 'Brown', 'Comp. Sci.', 58);
INSERT INTO student VALUES (76653, 'Aoi', 'Elec. Eng.', 60);
INSERT INTO student VALUES (98765, 'Bourikas', 'Elec. Eng.', 98);
INSERT INTO student VALUES (98988, 'Tanaka', 'Biology', 120);

-- takes
INSERT INTO takes VALUES (00128, 'CS-101', 1, 'Fall', 2017, 'A');
INSERT INTO takes VALUES (00128, 'CS-347', 1, 'Fall', 2017, 'A');
INSERT INTO takes VALUES (12345, 'CS-101', 1, 'Fall', 2017, 'C');
INSERT INTO takes VALUES (12345, 'CS-190', 2, 'Spring', 2017, 'A');
INSERT INTO takes VALUES (12345, 'CS-315', 1, 'Spring', 2018, 'A');
INSERT INTO takes VALUES (12345, 'CS-347', 1, 'Fall', 2017, 'A');
INSERT INTO takes VALUES (12345, 'CS-319', 2, 'Spring', 2018, 'B');
INSERT INTO takes VALUES (19991, 'HIS-351', 1, 'Spring', 2018, 'B');
INSERT INTO takes VALUES (23121, 'FIN-201', 1, 'Spring', 2018, 'C+');
INSERT INTO takes VALUES (44553, 'PHY-101', 1, 'Fall', 2017, 'B');
INSERT INTO takes VALUES (45678, 'CS-101', 1, 'Fall', 2017, 'F');
INSERT INTO takes VALUES (45678, 'CS-101', 1, 'Spring', 2018, 'B+');
INSERT INTO takes VALUES (45678, 'CS-319', 1, 'Spring', 2018, 'B');
INSERT INTO takes VALUES (54321, 'CS-101', 1, 'Fall', 2017, 'A');
INSERT INTO takes VALUES (54321, 'CS-190', 2, 'Spring', 2017, 'B+');
INSERT INTO takes VALUES (55739, 'MU-199', 1, 'Spring', 2018, 'A');
INSERT INTO takes VALUES (76543, 'CS-101', 1, 'Fall', 2017, 'A');
INSERT INTO takes VALUES (76543, 'CS-319', 2, 'Spring', 2018, 'A');
INSERT INTO takes VALUES (76653, 'EE-181', 1, 'Spring', 2017, 'C');
INSERT INTO takes VALUES (98765, 'CS-101', 1, 'Fall', 2017, 'C');
INSERT INTO takes VALUES (98765, 'CS-315', 1, 'Spring', 2018, 'B');
INSERT INTO takes VALUES (98988, 'BIO-101', 1, 'Summer', 2017, 'A');
INSERT INTO takes VALUES (98988, 'BIO-301', 1, 'Summer', 2018, NULL);

-- emp_super
INSERT INTO emp_super VALUES ('Alice', 'Bob');
INSERT INTO emp_super VALUES ('Bob', 'Carol');
INSERT INTO emp_super VALUES ('Carol', 'Dave');
INSERT INTO emp_super VALUES ('Dave', 'Eve');
INSERT INTO emp_super VALUES ('Frank', 'Bob');
INSERT INTO emp_super VALUES ('Grace', 'Carol');


-- ============================================
-- 3. QUERIES
-- ============================================

-- Q1. Find the average salary of all instructors.
SELECT AVG(salary) AS avg_salary
FROM instructor;

-- Q2. Find the total number of courses in the course table.
SELECT COUNT(*) AS total_courses
FROM course;

-- Q3. Find the maximum salary in the instructor table.
SELECT MAX(salary) AS max_salary
FROM instructor;

-- Q4. Find the total salary paid to all Comp. Sci. instructors.
SELECT SUM(salary) AS total_salary
FROM instructor
WHERE dept_name = 'Comp. Sci.';

-- Q5. Count the number of distinct departments that appear in the instructor table.
SELECT COUNT(DISTINCT dept_name) AS distinct_depts
FROM instructor;

-- Q6. Find the average salary for each department.
SELECT dept_name, AVG(salary) AS avg_salary
FROM instructor
GROUP BY dept_name;

-- Q7. List the departments that have more than two instructors, together with the number of instructors in each.
SELECT dept_name, COUNT(*) AS num_instructors
FROM instructor
GROUP BY dept_name
HAVING COUNT(*) > 2;

-- Q8. Find the names of instructors who work in Comp. Sci., Physics, or Biology.
SELECT name
FROM instructor
WHERE dept_name IN ('Comp. Sci.', 'Physics', 'Biology');

-- Q9. Using a subquery inside IN, find every course_id offered in Fall 2017 that was also offered in Spring 2018.
SELECT course_id
FROM section
WHERE semester = 'Fall' AND year = 2017
  AND course_id IN (
      SELECT course_id
      FROM section
      WHERE semester = 'Spring' AND year = 2018
  );

-- Q10. Using EXISTS with a correlated subquery, find the names of instructors who have taught at least one section.
SELECT name
FROM instructor I
WHERE EXISTS (
    SELECT 1
    FROM teaches T
    WHERE T.ID = I.ID
);

-- Q11. Using the > ALL construct, find the names of instructors whose salary is strictly greater than the salary of every History instructor.
--       Exclude NULLs from the subquery.
SELECT name
FROM instructor
WHERE salary > ALL (
    SELECT salary
    FROM instructor
    WHERE dept_name = 'History' AND salary IS NOT NULL
);

-- Q12. For each department, list the department name and the salary of its highest-paid instructor. Show only departments whose maximum salary exceeds 80000.
SELECT dept_name, MAX(salary) AS max_salary
FROM instructor
GROUP BY dept_name
HAVING MAX(salary) > 80000;

-- Q13. Using NOT EXISTS, find the names of instructors who have never taught any section.
SELECT name
FROM instructor I
WHERE NOT EXISTS (
    SELECT 1
    FROM teaches T
    WHERE T.ID = I.ID
);

-- Q14. Find the IDs and names of students who have taken every Comp. Sci. course.
--       Use the "for-all-via-NOT-EXISTS-and-EXCEPT" idiom.
SELECT S.ID, S.name
FROM student S
WHERE NOT EXISTS (
    SELECT C.course_id
    FROM course C
    WHERE C.dept_name = 'Comp. Sci.'
    EXCEPT
    SELECT T.course_id
    FROM takes T
    WHERE T.ID = S.ID
);

-- Q15. For each department, show its name and the number of instructors it employs,
--       but include only those departments whose average salary is greater than the
--       overall average salary across all instructors.
SELECT dept_name, COUNT(*) AS num_instructors
FROM instructor
WHERE dept_name IN (
    SELECT dept_name
    FROM instructor
    GROUP BY dept_name
    HAVING AVG(salary) > (SELECT AVG(salary) FROM instructor)
)
GROUP BY dept_name;
